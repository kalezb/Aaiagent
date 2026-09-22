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

class MessageEngine(
    private val service: AccessibilityService?,
    private val repository: AppRepository
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val adapterRegistry = AdapterRegistry(service!!)

    @Volatile var state: EngineState = EngineState.Idle
    @Volatile var currentPlatform: String = ""
    @Volatile var monitorMode: Boolean = false

    private val contexts = mutableMapOf<String, ConversationContext>()
    private var llmJob: Job? = null

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

        val fp = Deduplicator.fingerprint(platform, msg.sender + msg.content, "")
        if (Deduplicator.isSeenRecent(fp, DEDUP_WINDOW_MS)) return
        Deduplicator.markSeen(fp)

        // 监控模式：只同步记录
        if (monitorMode) {
            scope.launch(Dispatchers.IO) {
                try {
                    val apiService = ApiService(repository.getApiBaseUrl())
                    val token = repository.getActiveToken()?.token ?: return@launch
                    val adapter = adapterRegistry.getByPlatform(platform) ?: return@launch
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
        val adapter = adapterRegistry.getByPlatform(platform)
            ?: run { state = EngineState.Idle; return }

        state = EngineState.ReadingMessages

        try {
            val root = service?.rootInActiveWindow
                ?: run { state = EngineState.Idle; return }

            if (!adapter.isInChat(root)) {
                if (!adapter.isInMessageList(root)) {
                    adapter.navigateToMessageList(service!!, root)
                    delay(500)
                }
                val root2 = service.rootInActiveWindow ?: run { state = EngineState.Idle; return }
                val info = adapter.clickFirstUnreadConversation(root2, shouldClick = true)
                if (info == null) {
                    state = EngineState.Idle
                    return
                }
                delay(1000)
            }

            val root3 = service.rootInActiveWindow
                ?: run { state = EngineState.Idle; return }

            val messages = adapter.readMessages(root3)
            if (messages.isEmpty()) {
                state = EngineState.Idle
                return
            }

            // 敏感词检查
            val lastUserMsg = messages.lastOrNull { it.sender != "self" }
            if (lastUserMsg != null && SensitiveWords.isHit(lastUserMsg.content)) {
                state = EngineState.Idle
                return
            }

            state = EngineState.WaitingLLM

            val token = repository.getActiveToken()?.token ?: ""
            val apiService = ApiService(repository.getApiBaseUrl())
            val contactName = messages.firstOrNull()?.sender ?: "unknown"
            val contactId = contactName

            val location = repository.getLocation()

            var recalcCount = 0
            var reply: String? = null

            while (recalcCount < MAX_RECALC) {
                try {
                    val requestMessages = messages.map {
                        mapOf(
                            "role" to (if (it.sender == "self") "assistant" else "user"),
                            "content" to it.content
                        )
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
                        state = EngineState.Idle
                        return
                    }

                    if (response.error != null) {
                        recalcCount++
                        delay(1000)
                        continue
                    }

                    reply = response.reply
                    break
                } catch (e: Exception) {
                    recalcCount++
                    if (recalcCount >= MAX_RECALC) reply = "\u6069\u6069"
                    delay(1000)
                }
            }

            if (reply == null) reply = "\u6069\u6069\uff0c\u597d\u7684\u3002"

            state = EngineState.AboutToSend
            sendSplitReply(adapter, reply)

        } catch (e: Exception) {
            state = EngineState.Error
            e.printStackTrace()
        } finally {
            if (state != EngineState.Error) state = EngineState.Idle
            delay(randomDelay())
            try {
                val root = service?.rootInActiveWindow
                if (root != null) {
                    adapter.navigateToMessageList(service!!, root)
                }
            } catch (_: Exception) {}
        }
    }

    private suspend fun sendSplitReply(adapter: PlatformAdapter, text: String) {
        val sentences = splitSentences(text)

        for ((index, sentence) in sentences.withIndex()) {
            delay(PRE_SEND_CHECK_MS)
            if (GestureMonitor.isUserTouchingRecently(100)) {
                clearInputField()
                state = EngineState.Idle
                return
            }

            state = EngineState.Sending

            val root = service?.rootInActiveWindow ?: return
            val result = adapter.fillAndSend(service!!, root, sentence)

            if (result == PlatformAdapter.SendResult.BANNED) {
                state = EngineState.Idle
                return
            }

            if (index < sentences.size - 1) {
                delay(SPLIT_MIN_MS + Random.nextLong(SPLIT_MAX_MS - SPLIT_MIN_MS))
            }
        }
    }

    private fun splitSentences(text: String): List<String> {
        val raw = text.split(Regex("(?<=[\u3002\uff01\uff1f\\n])"))
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
            val adapter = adapterRegistry.getByPlatform(currentPlatform) ?: return
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






