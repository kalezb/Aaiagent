package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.network.ChatRequest
import kotlinx.coroutines.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.random.Random

sealed class EngineState {
    object Idle : EngineState()
    object ScanningConversations : EngineState()
    object ReadingMessages : EngineState()
    object WaitingLLM : EngineState()
    object AboutToSend : EngineState()
    object Sending : EngineState()
    object UserInChatRoom : EngineState()
    object Paused : EngineState()
    object Error : EngineState()
}

enum class HostingMode {
    FULL_AUTO,
    SEMI_AUTO,
    MONITOR_ONLY
}

class MessageEngine(
    private val service: AccessibilityService?,
    private val repository: AppRepository
) {
   private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
   private val adapterRegistry: AdapterRegistry? = service?.let { AdapterRegistry(it) }
   private var pollingJob: Job? = null

   init {
        service?.let {
            val logDir = java.io.File(it.filesDir, "journal")
            RuntimeJournal.init(logDir)
        }
    }

    @Volatile var state: EngineState = EngineState.Idle
    @Volatile var currentPlatform: String = ""
    @Volatile var hostingMode: HostingMode = HostingMode.FULL_AUTO
    @Volatile var hostingEnabled: Boolean = false

    private val contexts = mutableMapOf<String, ConversationContext>()
    private var llmJob: Job? = null

   fun startHosting(platform: String) {
       val wasHosting = hostingEnabled
       hostingEnabled = true
       currentPlatform = platform
       
       if (!wasHosting) {
           state = EngineState.Idle
           pollingJob?.cancel()
           pollingJob = scope.launch {
               delay(500)
               while (hostingEnabled && isActive) {
                   // ═══ P0-问题1: 空闲保护——用户5秒内碰过屏幕就跳过 ═══
                   if (GestureMonitor.isUserTouchingRecently(5000)) {
                       android.util.Log.d("AIA", "polling: user touched within 5s, skip")
                       delay(3000)
                       continue
                   }
                   if (state == EngineState.Idle || state == EngineState.Error) {
                       if (state == EngineState.Error) state = EngineState.Idle
                       try { scanAndProcess() } catch (e: Exception) { android.util.Log.e("AIA", "scanAndProcess crashed", e); state = EngineState.Error }
                   }
                   // ═══ P2-问题8: 轮询间隔改为3秒 ═══
                   delay(3000)
               }
           }
       } else {
           if (state == EngineState.Idle) {
               scope.launch { scanAndProcess() }
           }
       }
   }

   fun stopHosting() {
       hostingEnabled = false
       pollingJob?.cancel()
       pollingJob = null
       state = EngineState.Idle
       llmJob?.cancel()
   }

    private suspend fun scanAndProcess() {
        android.util.Log.d("AIA", "scanAndProcess: start, platform=$currentPlatform, hostingMode=$hostingMode")
        val svc = service
        if (svc == null) {
            android.util.Log.e("AIA", "scanAndProcess: service is null!")
            state = EngineState.Error
            return
        }
        
        val adapter = adapterRegistry?.getByPlatform(currentPlatform)
        if (adapter == null) {
            android.util.Log.w("AIA", "scanAndProcess: no adapter for $currentPlatform")
            return
        }

        var root = svc.rootInActiveWindow
        if (root == null) {
            android.util.Log.w("AIA", "scanAndProcess: rootInActiveWindow is null, trying bringToForeground")
            try { adapter.bringToForeground(svc) } catch (_: Exception) {}
            delay(3000)
            root = svc.rootInActiveWindow
            if (root == null) {
                android.util.Log.w("AIA", "scanAndProcess: root still null after bringToForeground")
                state = EngineState.Idle
                return
            }
        }

        val currentPkg = root.packageName?.toString() ?: ""
        android.util.Log.d("AIA", "scanAndProcess: current foreground pkg=$currentPkg, target=${adapter.packageName}")

        if (currentPkg != adapter.packageName) {
            android.util.Log.d("AIA", "scanAndProcess: not in target app, bringing to foreground")
            try { adapter.bringToForeground(svc) } catch (_: Exception) {}
            delay(3500)
            root = svc.rootInActiveWindow
            if (root == null) {
                android.util.Log.w("AIA", "scanAndProcess: root null after bringToForeground (2)")
                state = EngineState.Idle
                return
            }
        }

        val inMsgList = adapter.isInMessageList(root)
        android.util.Log.d("AIA", "scanAndProcess: isInMessageList=$inMsgList")
        if (!inMsgList) {
            android.util.Log.d("AIA", "scanAndProcess: navigating to message list...")
            try { adapter.navigateToMessageList(svc, root) } catch (_: Exception) {}
            delay(1000)
            root = svc.rootInActiveWindow
            if (root == null) {
                android.util.Log.w("AIA", "scanAndProcess: root null after navigate")
                state = EngineState.Idle
                return
            }
        }

        RuntimeJournal.stateChange(state.toString(), "ScanningConversations")
        state = EngineState.ScanningConversations

        for (attempt in 1..5) {
            android.util.Log.d("AIA", "scanAndProcess: scanning attempt $attempt/5")
            try {
                val info = adapter.clickFirstUnreadConversation(root, shouldClick = true)
                if (info != null) {
                    android.util.Log.d("AIA", "scanAndProcess: found unread: ${info.contactName}, clicking...")
                    val ctx = getOrCreateContext(currentPlatform, info.contactId)
                    ctx.contactName = info.contactName
                    ctx.contactId = info.contactId
                    ctx.llmRequestId++
                    if (ctx.firstMessageAt == 0L) ctx.firstMessageAt = System.currentTimeMillis()
                    
                    RuntimeJournal.clickConversation(info.contactName, true)
                    
                    // ═══ P1-问题5: 点会话后等2.5秒再检查 ═══
                    delay(2500)
                    var chatWaitRetries = 0
                    var chatRoot = service?.rootInActiveWindow

                    // ═══ P0-问题2: 进聊天页后验证标题，防止进错人 ═══
                    if (chatRoot != null && adapter is com.aaiagent.adapter.SoulAdapter) {
                        val soulAdapter = adapter as com.aaiagent.adapter.SoulAdapter
                        val actualTitle = soulAdapter.readChatTitle(chatRoot)
                        if (actualTitle != null && actualTitle.isNotEmpty()) {
                            val expectedName = info.contactName
                            android.util.Log.d("AIA", "scanAndProcess: title check - expected='$expectedName' actual='$actualTitle'")
                            if (!actualTitle.contains(expectedName) && !expectedName.contains(actualTitle) && expectedName != "unknown") {
                                android.util.Log.w("AIA", "scanAndProcess: title mismatch! expected='$expectedName' got='$actualTitle', backing out")
                                try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK) } catch (_: Exception) {}
                                delay(800)
                                state = EngineState.Idle
                                return
                            }
                            android.util.Log.d("AIA", "scanAndProcess: title matched!")
                        }
                    }

                    while (chatWaitRetries < 5 && chatRoot != null && !adapter.isInChat(chatRoot)) {
                        android.util.Log.d("AIA", "processConversation: waiting for chat... attempt " + (chatWaitRetries + 1) + "/5")
                        kotlinx.coroutines.delay(1000)
                        chatRoot = service?.rootInActiveWindow
                        // 不再导航回消息列表——我们正在等待聊天页加载
                        chatWaitRetries++
                    }
                    if (chatRoot != null) root = chatRoot
                    
                    processConversation(ctx)
                    return
                }
            } catch (e: Exception) {
                android.util.Log.e("AIA", "scanAndProcess: error on attempt $attempt", e)
            }
            android.util.Log.d("AIA", "scanAndProcess: no unread found on attempt $attempt")
            delay(1500)
            val r = svc.rootInActiveWindow
            if (r != null) root = r
        }

        android.util.Log.d("AIA", "scanAndProcess: no unread after 5 attempts, going idle")
        state = EngineState.Idle
    }
    companion object {
        const val SHORT_WINDOW_MS = 500L
        const val MAX_RECALC = 3
        const val MAX_WAIT_MS = 8000L
        const val DEDUP_WINDOW_MS = 5 * 60 * 1000L
        const val PRE_SEND_CHECK_MS = 100L
        const val DELAY_MIN_MS = 500L
        const val DELAY_MAX_MS = 1500L
        const val SPLIT_MIN_MS = 1000L
        const val SPLIT_MAX_MS = 2000L
    }

    fun onPageChanged(isInChatRoom: Boolean) {
        if (isInChatRoom && state == EngineState.Idle) {
            state = EngineState.UserInChatRoom
        } else if (!isInChatRoom && state == EngineState.UserInChatRoom) {
            state = EngineState.Idle
        }
    }

    fun onNewMessage(platform: String, msg: PlatformAdapter.MessageInfo) {
        if (state == EngineState.UserInChatRoom || state == EngineState.Paused) return
        if (state == EngineState.Error) return

        RuntimeJournal.notifyReceived(platform, msg.sender, msg.content)

        val fp = Deduplicator.fingerprint(platform, msg.sender + msg.content, "")
        if (Deduplicator.isSeenRecent(fp, DEDUP_WINDOW_MS)) return
        Deduplicator.markSeen(fp)

        if (hostingMode == HostingMode.MONITOR_ONLY) {
            scope.launch(Dispatchers.IO) {
                try {
                    val apiService = ApiService(repository.getApiBaseUrl())
                    val token = repository.getActiveToken()?.token ?: return@launch
                    val adapter = adapterRegistry?.getByPlatform(platform) ?: return@launch
                    val root = service?.rootInActiveWindow ?: return@launch
                    val messages = adapter.readMessages(root).map {
                        mapOf("role" to it.sender, "content" to it.content)
                    }
                    apiService.syncMessages(
                        token, platform, "unknown", "unknown", messages
                    )
                } catch (_: Exception) {}
            }
            return
        }

        val key = platform + ":" + msg.sender
        val ctx = getOrCreateContext(platform, msg.sender)
        synchronized(ctx) {
            ctx.llmRequestId++
            if (ctx.firstMessageAt == 0L) ctx.firstMessageAt = System.currentTimeMillis()
        }

        when (state) {
            EngineState.Idle -> {
                currentPlatform = platform
                state = EngineState.ScanningConversations
                startShortWindow(ctx)
            }
            EngineState.WaitingLLM -> {
                llmJob?.cancel()
                startProcessing(ctx)
            }
            else -> {}
        }
    }

    fun onUserInteraction() {
        GestureMonitor.onTouchDetected()
        if (state == EngineState.AboutToSend || state == EngineState.Sending) {
            clearInputField()
            state = EngineState.Idle
        }
    }

    private fun getOrCreateContext(platform: String, contactId: String): ConversationContext {
        val key = platform + ":" + contactId
        return contexts.getOrPut(key) { ConversationContext(platform, contactId) }
    }

    private fun startShortWindow(ctx: ConversationContext) {
        llmJob?.cancel()
        llmJob = scope.launch {
            delay(SHORT_WINDOW_MS)
            if (state == EngineState.ScanningConversations) {
                startProcessing(ctx)
            }
        }
        scope.launch {
            delay(MAX_WAIT_MS)
            if (state == EngineState.ScanningConversations) {
                llmJob?.cancel()
                startProcessing(ctx)
            }
        }
    }

    private fun startProcessing(ctx: ConversationContext) {
        llmJob?.cancel()
        llmJob = scope.launch {
            processConversation(ctx)
        }
    }

    private suspend fun processConversation(ctx: ConversationContext) {
        val platform = currentPlatform
        val adapter = adapterRegistry?.getByPlatform(platform)
            ?: run { state = EngineState.Idle; return }

        RuntimeJournal.stateChange("Idle", "ReadingMessages")
        state = EngineState.ReadingMessages
        android.util.Log.d("AIA", "pc: ENTER platform=" + platform + " mode=" + hostingMode.toString())

        try {
            var root = service?.rootInActiveWindow
                ?: run { state = EngineState.Idle; return }

            if (!adapter.isInChat(root)) {
                if (!adapter.isInMessageList(root)) {
                    adapter.navigateToMessageList(service!!, root)
                    delay(500)
                }
                val root2 = service?.rootInActiveWindow ?: run { state = EngineState.Idle; return }
                var info = adapter.clickFirstUnreadConversation(root2, shouldClick = true)
                if (info == null) {
                    info = ErrorRecovery.retryClickConversation(adapter, service!!, root2)
                }
                if (info == null) {
                    RuntimeJournal.clickConversation("unknown", false)
                    state = EngineState.Idle
                    return
                }
                ctx.contactName = info.contactName
                ctx.contactId = info.contactId
                RuntimeJournal.clickConversation(info.contactName, true)
                delay(2500)
                var chatWaitRetries = 0
                var chatRoot = service?.rootInActiveWindow
                
                // title verification for processConversation path
                if (chatRoot != null && adapter is com.aaiagent.adapter.SoulAdapter) {
                    val soulAdapter = adapter as com.aaiagent.adapter.SoulAdapter
                    val actualTitle = soulAdapter.readChatTitle(chatRoot)
                    if (actualTitle != null && actualTitle.isNotEmpty() && info.contactName != "unknown") {
                        if (!actualTitle.contains(info.contactName) && !info.contactName.contains(actualTitle)) {
                            android.util.Log.w("AIA", "processConversation: title mismatch! backing out")
                            try { service!!.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK) } catch (_: Exception) {}
                            delay(800)
                            state = EngineState.Idle
                            return
                        }
                    }
                }
                
                while (chatWaitRetries < 5 && chatRoot != null && !adapter.isInChat(chatRoot)) {
                    android.util.Log.d("AIA", "processConversation: waiting for chat... attempt " + (chatWaitRetries + 1) + "/5")
                    kotlinx.coroutines.delay(1000)
                    chatRoot = service?.rootInActiveWindow
                    // 不再导航回消息列表——我们正在等待聊天页加载
                    chatWaitRetries++
                }
                if (chatRoot != null) root = chatRoot
            }

            root = ErrorRecovery.recoverReadMessages(adapter, service!!)
                ?: service?.rootInActiveWindow
                ?: run { state = EngineState.Idle; return }

            var messages = adapter.readMessages(root)
            var readRetries = 0
            while (messages.isEmpty() && readRetries < 3) {
                android.util.Log.d("AIA", "processConversation: readMessages empty, retry " + (readRetries + 1) + "/3")
                kotlinx.coroutines.delay(1500)
                root = service?.rootInActiveWindow ?: run { state = EngineState.Idle; return }
                if (!adapter.isInChat(root)) {
                    android.util.Log.w("AIA", "processConversation: lost chat page during read retry")
                    state = EngineState.Idle
                    return
                }
                messages = adapter.readMessages(root)
                readRetries++
            }
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                android.util.Log.w("AIA", "processConversation: readMessages still empty after retries")
                state = EngineState.Error
                return
            }
            RuntimeJournal.readMessages(messages.size, messages.lastOrNull()?.content ?: "")
            android.util.Log.d("AIA", "pc: read " + messages.size + " msgs, last=" + (messages.lastOrNull()?.content?.take(50) ?: "none"))

            val lastUserMsg = messages.lastOrNull { it.sender != "self" }
            if (lastUserMsg != null && SensitiveWords.isHit(lastUserMsg.content)) {
                state = EngineState.Idle
                return
            }

            if (hostingMode == HostingMode.MONITOR_ONLY) {
                android.util.Log.d("AIA", "processConversation: MONITOR_ONLY - syncing only")
                scope.launch(Dispatchers.IO) {
                    try {
                        val api = ApiService(repository.getApiBaseUrl())
                        val tk = repository.getActiveToken()?.token ?: return@launch
                        val list = messages.map { mapOf("role" to it.sender, "content" to it.content) }
                        api.syncMessages(tk, platform, ctx.contactId, ctx.contactName, list)
                    } catch (_: Exception) {}
                }
                state = EngineState.Idle
                return
            }

            state = EngineState.WaitingLLM

            val token = withContext(Dispatchers.IO) { repository.getActiveToken()?.token } ?: ""
            val apiBaseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
            val apiService = ApiService(apiBaseUrl)
            val contactName = ctx.contactName.ifEmpty { "unknown" }
            val contactId = ctx.contactId.ifEmpty { contactName }

            val location = withContext(Dispatchers.IO) { repository.getLocation() }

            var recalcCount = 0
            var reply: String? = null
            val requestIdAtCall = ctx.llmRequestId

            while (recalcCount < MAX_RECALC) {
                try {
                    val requestMessages = messages.map {
                        mapOf(
                            "role" to (if (it.sender == "self") "assistant" else "user"),
                            "content" to it.content
                        )
                    }
                    android.util.Log.d("AIA", "pc: calling LLM for contact=" + contactName + " msgs=" + requestMessages.size)

                    // ????????????????? skip
                    try {
                        val regOk = apiService.registerContact(token, platform, contactId, contactName)
                        android.util.Log.d("AIA", "pc: registerContact result=" + regOk)
                    } catch (e: Exception) {
                        android.util.Log.w("AIA", "pc: registerContact failed: " + e.message)
                    }

                    val response = apiService.chat(
                        ChatRequest(
                            token = token,
                            platform = platform,
                            contactId = contactId,
                            contactName = contactName,
                            messages = requestMessages,
                            location = location
                        )
                    )

                    if (response.action == "skip") {
                        android.util.Log.w("AIA", "pc: backend returned skip for " + contactName)
                        state = EngineState.Idle
                        return
                    }

                    if (response.error != null) {
                        recalcCount++
                        delay(1000)
                        continue
                    }

                    // === 4.5 ?????LLM???????????????? ===
                    if (ctx.llmRequestId != requestIdAtCall) {
                        val elapsed = System.currentTimeMillis() - ctx.firstMessageAt
                        android.util.Log.d("AIA", "pc: new msg during LLM (id " + requestIdAtCall + "->" + ctx.llmRequestId + ", elapsed=" + elapsed + "ms)")
                        if (recalcCount < MAX_RECALC && elapsed < MAX_WAIT_MS) {
                            recalcCount++
                            val freshRoot = service?.rootInActiveWindow
                            if (freshRoot != null && adapter.isInChat(freshRoot)) {
                                val newMsgs = adapter.readMessages(freshRoot)
                                if (newMsgs.isNotEmpty()) {
                                    messages = newMsgs
                                    android.util.Log.d("AIA", "pc: re-read " + newMsgs.size + " msgs, recomputing")
                                }
                            }
                            delay(300)
                            continue
                        }
                        android.util.Log.w("AIA", "pc: force send (recalc=" + recalcCount + " elapsed=" + elapsed + "ms)")
                    }

                    reply = response.reply
                    android.util.Log.d("AIA", "pc: LLM reply len=" + (reply?.length ?: 0) + " action=" + response.action)
                    break
                } catch (e: Exception) {
                    recalcCount++
                    if (recalcCount >= MAX_RECALC) reply = "嗯嗯"
                    delay(1000)
                }
            }

            if (reply == null) reply = "嗯嗯，好的。"

            RuntimeJournal.llmCalled("platform=$platform contact=$contactName", reply!!)

            when (hostingMode) {
                HostingMode.FULL_AUTO -> {
                    state = EngineState.AboutToSend
                    sendSplitReply(adapter, reply)
                }
                HostingMode.SEMI_AUTO -> {
                    android.util.Log.d("AIA", "processConversation: SEMI_AUTO - fill only")
                    if (adapter is com.aaiagent.adapter.SoulAdapter) {
                        (adapter as com.aaiagent.adapter.SoulAdapter).fillInputOnly(reply)
                    }
                    state = EngineState.Idle
                }
                else -> { state = EngineState.Idle }
            }

        } catch (e: Exception) {
            RuntimeJournal.stateChange(state.toString(), "Error")
            state = EngineState.Error
            try { ErrorRecovery.recoverSend(adapter, service!!) } catch (_: Exception) {}
            e.printStackTrace()
        } finally {
            if (state != EngineState.Error) state = EngineState.Idle
            delay(randomDelay())
            try {
                val root = service?.rootInActiveWindow
                val adp = adapterRegistry?.getByPlatform(platform) ?: return
                if (root != null) {
                    adp.navigateToMessageList(service!!, root)
                }
            } catch (_: Exception) {}
        }
    }

    private suspend fun sendSplitReply(adapter: PlatformAdapter, text: String) {
        val sentences = splitSentences(text)
            .map { normalizeReply(it) }
            .filter { it.isNotEmpty() }

        for ((index, sentence) in sentences.withIndex()) {
            delay(PRE_SEND_CHECK_MS)
            if (GestureMonitor.isUserTouchingRecently(100)) {
                clearInputField()
                state = EngineState.Idle
                return
            }

            state = EngineState.Sending
            android.util.Log.d("AIA", "sendSplit: sending sentence idx=" + index + " len=" + sentence.length)

            val root = service?.rootInActiveWindow ?: return
            val result = adapter.fillAndSend(service!!, root, sentence)

            if (result == PlatformAdapter.SendResult.BANNED) {
                RuntimeJournal.messageSent(false, "被禁言")
                state = EngineState.Idle
                return
            }

            if (index < sentences.size - 1) {
                delay(SPLIT_MIN_MS + Random.nextLong(SPLIT_MAX_MS - SPLIT_MIN_MS))
            }
        }
        RuntimeJournal.messageSent(true)
    }

    // ?????????????????????????
    private fun normalizeReply(text: String): String {
        var t = text
        t = t.replace(Regex("[?,??;?:]"), " ")
        t = t.replace(Regex("[?.]"), "")
        t = t.replace(Regex("[??\"\'??]"), "")
        t = t.replace(Regex("[ \t]+"), " ")
        return t.trim()
    }

    private fun splitSentences(text: String): List<String> {
        val raw = text.split(Regex("(?<=[。！？\\n])"))
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (raw.isEmpty()) return listOf(text)
        if (raw.size <= 1 || text.length <= 15) return listOf(text)
        if (raw.size > 5) return listOf(text)

        return raw
    }

    private fun clearInputField() {
        try {
            val root = service?.rootInActiveWindow ?: return
            val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return
            val inputNodes = root.findAccessibilityNodeInfosByViewId(
                adapter.packageName + ":id/et_sendmessage"
            )
            val inputField = inputNodes.firstOrNull { it.isEditable } ?: return
            val args = Bundle()
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } catch (_: Exception) {}
    }

    private fun randomDelay(): Long = DELAY_MIN_MS + Random.nextLong(DELAY_MAX_MS - DELAY_MIN_MS)

    fun currentState(): EngineState = state
    fun shutdown() { scope.cancel() }
}
