package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulAdapter
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.network.ChatRequest
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val adapterRegistry: AdapterRegistry? = service?.let { AdapterRegistry(it) }
    private val lease = AutomationLease()
    private val wakeSignal = Channel<Unit>(Channel.CONFLATED)
    private val contexts = mutableMapOf<String, ConversationContext>()

    private var hostingJob: Job? = null

    @Volatile
    var state: EngineState = EngineState.Idle
        private set

    @Volatile
    var currentPlatform: String = ""
        private set

    @Volatile
    var hostingMode: HostingMode = HostingMode.FULL_AUTO

    @Volatile
    var hostingEnabled: Boolean = false
        private set

    @Volatile
    private var activeLeaseToken: String = ""

    @Volatile
    private var activeContext: ConversationContext? = null

    init {
        service?.let {
            RuntimeJournal.init(java.io.File(it.filesDir, "journal"))
        }
    }

    fun startHosting(platform: String) {
        currentPlatform = platform
        hostingEnabled = true
        GestureMonitor.onAutomationActionStarted(protectionMs = 1_500L)
        RuntimeJournal.stateChange(state.toString(), "HostingStarted")

        if (hostingJob?.isActive == true && lease.owns(activeLeaseToken)) {
            lease.renew(activeLeaseToken)
            wakeSignal.trySend(Unit)
            return
        }

        hostingJob?.cancel()
        activeLeaseToken = lease.acquire()
        val leaseToken = activeLeaseToken
        hostingJob = scope.launch {
            runHostingLoop(leaseToken)
        }
    }

    fun stopHosting() {
        hostingEnabled = false
        lease.revoke()
        hostingJob?.cancel()
        hostingJob = null
        activeContext = null
        clearInputField()
        state = EngineState.Idle
    }

    private suspend fun runHostingLoop(leaseToken: String) {
        delay(400)
        while (hostingEnabled && lease.owns(leaseToken) && scope.isActive) {
            lease.renew(leaseToken)
            if (GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS)) {
                state = EngineState.Paused
                delay(500)
                continue
            }

            if (state == EngineState.Error || state == EngineState.Paused) state = EngineState.Idle
            if (state == EngineState.Idle) {
                try {
                    scanAndProcess(leaseToken)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    android.util.Log.e("AIA", "hosting loop crashed", error)
                    RuntimeJournal.recovery("托管循环异常: ${error.message}")
                    state = EngineState.Error
                }
            }

            withTimeoutOrNull(POLL_INTERVAL_MS) {
                wakeSignal.receive()
            }
        }

        if (hostingEnabled && !lease.owns(leaseToken)) {
            android.util.Log.w("AIA", "hosting loop stopped because lease was revoked")
        }
    }

    private suspend fun scanAndProcess(leaseToken: String) {
        if (!canContinue(leaseToken, null)) return
        val svc = service ?: run {
            state = EngineState.Error
            return
        }
        val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return

        val activeRoot = svc.rootInActiveWindow
        if (activeRoot?.packageName?.toString() == adapter.packageName && adapter.isInChat(activeRoot)) {
            val title = adapter.readChatTitle(activeRoot)
            if (!title.isNullOrBlank()) {
                processVerifiedChat(adapter, activeRoot, title, title, leaseToken)
                return
            }
        }

        state = EngineState.ScanningConversations
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            state = EngineState.Idle
            return
        }
        if (!canContinue(leaseToken, null)) return

        val info = adapter.clickFirstUnreadConversation(listRoot, shouldClick = true)
        if (info == null) {
            state = EngineState.Idle
            return
        }
        RuntimeJournal.clickConversation(info.contactName, true)

        val verifiedChat = waitForVerifiedChat(svc, adapter, info.contactName, leaseToken)
        if (verifiedChat == null) {
            state = EngineState.Idle
            return
        }

        processVerifiedChat(adapter, verifiedChat, info.contactId, info.contactName, leaseToken)
    }

    private suspend fun processVerifiedChat(
        adapter: PlatformAdapter,
        chatRoot: AccessibilityNodeInfo,
        contactId: String,
        contactName: String,
        leaseToken: String
    ) {
        val context = getOrCreateContext(currentPlatform, contactId).also {
            it.contactName = contactName
            synchronized(it) {
                it.llmRequestId++
                it.firstMessageAt = System.currentTimeMillis()
                it.recalcCount = 0
            }
            activeContext = it
        }

        try {
            processConversation(adapter, context, chatRoot, leaseToken)
        } finally {
            activeContext = null
        }
    }

    private suspend fun ensureMessageList(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        leaseToken: String
    ): AccessibilityNodeInfo? {
        repeat(5) { attempt ->
            if (!canContinue(leaseToken, null)) return null
            var root = svc.rootInActiveWindow
            if (root?.packageName?.toString() != adapter.packageName) {
                RuntimeJournal.recovery("目标不在前台，拉起${adapter.packageName}")
                adapter.bringToForeground(svc)
                delay(if (attempt == 0) 2_000 else 1_000)
                root = svc.rootInActiveWindow
            }

            if (root?.packageName?.toString() == adapter.packageName) {
                if (adapter.isInMessageList(root)) return root
                adapter.navigateToMessageList(svc, root)
                delay(900)
                val fresh = svc.rootInActiveWindow
                if (fresh != null && adapter.isInMessageList(fresh)) return fresh
            } else {
                delay(700)
            }
        }
        RuntimeJournal.wrongPage("无法进入消息列表")
        return null
    }

    private suspend fun waitForVerifiedChat(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        expectedContactName: String,
        leaseToken: String
    ): AccessibilityNodeInfo? {
        repeat(MAX_CHAT_WAIT_RETRIES) { attempt ->
            delay(if (attempt == 0) 2_500L else 1_000L)
            if (!canContinue(leaseToken, null)) return null
            val root = svc.rootInActiveWindow ?: return@repeat
            if (root.packageName?.toString() != adapter.packageName) return@repeat
            if (!adapter.isInChat(root)) return@repeat

            val actualTitle = adapter.readChatTitle(root)
            if (ConversationIdentity.matches(expectedContactName, actualTitle)) {
                android.util.Log.d("AIA", "chat identity verified expected=$expectedContactName actual=$actualTitle")
                return root
            }
            if (actualTitle != null) {
                RuntimeJournal.recovery("进入错会话 expected=$expectedContactName actual=$actualTitle")
                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                delay(600)
                return null
            }
        }

        RuntimeJournal.recovery("聊天页或联系人标题验证失败 expected=$expectedContactName")
        try {
            svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        } catch (_: Exception) {
        }
        return null
    }

    private suspend fun processConversation(
        adapter: PlatformAdapter,
        context: ConversationContext,
        chatRoot: AccessibilityNodeInfo,
        leaseToken: String
    ) {
        val interactionEpoch = GestureMonitor.interactionEpoch()
        state = EngineState.ReadingMessages
        RuntimeJournal.stateChange("Idle", "ReadingMessages")

        try {
            var root = chatRoot
            var messages = readMessagesWithRetry(adapter, root, context.contactName, leaseToken)
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                return
            }

            val lastMessage = messages.lastOrNull() ?: return
            if (!ConversationReplyPolicy.shouldReply(lastMessage.sender)) {
                android.util.Log.d("AIA", "conversation has no unanswered incoming message")
                return
            }
            val incomingBatch = IncomingMessageBatch.select(messages) ?: return
            val latestIncoming = incomingBatch.latestIncoming
            android.util.Log.d(
                "AIA",
                "incoming batch size=${incomingBatch.incoming.size} media=${incomingBatch.mediaTarget?.type ?: "text"} latest=${latestIncoming.content}"
            )
            RuntimeJournal.readMessages(messages.size, latestIncoming.content)
            val incomingBatchFingerprint = IncomingMessageBatch.fingerprint(incomingBatch)
            if (IncomingConversationTracker.isAlreadyHandled(
                handledFingerprint = context.lastRepliedIncomingFingerprint,
                currentFingerprint = incomingBatchFingerprint
            )) {
                android.util.Log.d("AIA", "conversation already handled, skip duplicate reply")
                return
            }
            synchronized(context) {
                context.lastIncomingFingerprint = incomingFingerprint(latestIncoming)
            }
            if (incomingBatch.incoming.any { SensitiveWords.isHit(it.content) }) return
            if (hostingMode == HostingMode.MONITOR_ONLY) {
                syncMessages(context, messages)
                synchronized(context) {
                    context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                }
                return
            }
            val token = withContext(Dispatchers.IO) { repository.getActiveToken()?.token?.trim() }.orEmpty()
            val apiBaseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
            val api = ApiService(apiBaseUrl)
            if (token.isEmpty()) {
                RuntimeJournal.recovery("设备密钥为空，停止处理")
                state = EngineState.Error
                return
            }
            val understanding = understandIncomingBatch(
                adapter = adapter,
                root = root,
                messages = messages,
                incomingBatch = incomingBatch,
                api = api,
                token = token,
                leaseToken = leaseToken,
                interactionEpoch = interactionEpoch
            )
            messages = understanding.messages

            val reply = understanding.fallbackReply ?: requestReply(
                adapter = adapter,
                context = context,
                messages = messages,
                api = api,
                token = token,
                leaseToken = leaseToken,
                interactionEpoch = interactionEpoch
            ) ?: return

            if (!canContinue(leaseToken, interactionEpoch)) return
            when (hostingMode) {
                HostingMode.FULL_AUTO -> {
                    state = EngineState.AboutToSend
                    val sentAny = sendReply(adapter, context, reply, leaseToken, interactionEpoch)
                    if (sentAny) {
                        synchronized(context) {
                            context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                        }
                        if (HostingCompletionPolicy.shouldReturnToMessageList(
                                mode = hostingMode,
                                sentAny = true,
                                automationStillOwned = canContinue(leaseToken, interactionEpoch)
                            )
                        ) {
                            val svc = service
                            val currentRoot = svc?.rootInActiveWindow
                            if (svc != null && currentRoot != null) {
                                state = EngineState.ScanningConversations
                                adapter.navigateToMessageList(svc, currentRoot)
                                android.util.Log.d("AIA", "full auto returned to message list")
                            }
                        }
                    }
                }
                HostingMode.SEMI_AUTO -> {
                    if (adapter is SoulAdapter) {
                        if (adapter.fillInputOnly(reply, context.contactName)) {
                            synchronized(context) {
                                context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                            }
                        }
                    }
                }
                HostingMode.MONITOR_ONLY -> Unit
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            RuntimeJournal.recovery("处理会话异常: ${error.message}")
            android.util.Log.e("AIA", "processConversation failed", error)
            state = EngineState.Error
            try {
                ErrorRecovery.recoverSend(adapter, service ?: return)
            } catch (_: Exception) {
            }
        } finally {
            if (state != EngineState.Error) state = EngineState.Idle
        }
    }

    private suspend fun readMessagesWithRetry(
        adapter: PlatformAdapter,
        initialRoot: AccessibilityNodeInfo,
        expectedContactName: String,
        leaseToken: String
    ): List<PlatformAdapter.ChatMessage> {
        var root = initialRoot
        repeat(READ_MESSAGE_RETRIES) { attempt ->
            if (!canContinue(leaseToken, null)) return emptyList()
            if (!verifyCurrentChat(adapter, expectedContactName)) {
                if (attempt == 0) delay(700)
                root = service?.rootInActiveWindow ?: return emptyList()
            }
            val messages = adapter.readMessages(root)
            if (messages.isNotEmpty()) return messages
            delay(1_000)
            root = service?.rootInActiveWindow ?: return emptyList()
        }
        return emptyList()
    }

    private suspend fun understandIncomingBatch(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        messages: List<PlatformAdapter.ChatMessage>,
        incomingBatch: IncomingMessageBatch.Selection,
        api: ApiService,
        token: String,
        leaseToken: String,
        interactionEpoch: Long
    ): MediaUnderstanding {
        val mediaTarget = incomingBatch.mediaTarget ?: return MediaUnderstanding(messages, null)
        if (mediaTarget.type == "text" || mediaTarget.type == "unknown") {
            return MediaUnderstanding(messages, null)
        }

        val svc = service ?: return MediaUnderstanding(messages, fallbackFor(mediaTarget.type))
        if (!canContinue(leaseToken, interactionEpoch)) return MediaUnderstanding(messages, null)
        android.util.Log.d("AIA", "media understanding start type=${mediaTarget.type}")

        if (mediaTarget.type == "voice") {
            val transcribed = VoiceHandler.tryTranscribe(svc, root, currentPlatform)
            if (!transcribed.isNullOrBlank()) {
                return MediaUnderstanding(
                    replaceLatest(messages, mediaTarget, "对方语音转文字：$transcribed"),
                    null
                )
            }
        }

        val prompt = when (mediaTarget.type) {
            "exchange" -> "这是社交聊天中的以图换图照片。请先识别图片主体、人物状态、生活场景和可聊话题，忽略截图方向与界面元素，用一到三句中文描述。"
            "image" -> "这是社交聊天中的图片。请识别图片里可见的文字、物体、场景和可能表达的情绪，用一句到三句话描述。"
            "sticker" -> "这是社交聊天中的表情包。请描述表情、动作、文字和它可能表达的聊天含义。"
            "interaction" -> "这是社交聊天中的拍一拍或戳一戳互动。请只描述界面上能确认的互动内容。"
            "voice" -> "这是社交聊天语音消息附近的截图。只描述能确认的文字或界面内容，不要猜测语音内容。"
            else -> "简要描述这张聊天截图中的消息内容。"
        }
        val preparation = adapter.prepareVisualCapture(root, mediaTarget.type)
        if (preparation == null) {
            RuntimeJournal.recovery("隐私图片展开失败 type=${mediaTarget.type}")
            return MediaUnderstanding(messages, fallbackFor(mediaTarget.type))
        }
        val preparedRoot = preparation.root
        android.util.Log.d(
            "AIA",
            "visual page prepared type=${mediaTarget.type} privacy=${preparation.privacyProtected}"
        )
        val imageBase64 = try {
            ScreenCapture.captureJpegBase64(
                service = svc,
                targetBounds = adapter.readVisualTargetBounds(preparedRoot, mediaTarget.type),
                rejectMostlyBlack = preparation.privacyProtected
            )
        } finally {
            adapter.finishVisualCapture(preparedRoot)
        }
        if (imageBase64.isNullOrEmpty()) {
            if (PrivacyPhotoPolicy.shouldUseModelContext(
                    privacyProtected = preparation.privacyProtected,
                    captureAvailable = false
                )
            ) {
                return MediaUnderstanding(
                    replaceLatest(messages, mediaTarget, PrivacyPhotoPolicy.MODEL_CONTEXT),
                    null
                )
            }
            RuntimeJournal.recovery("视觉识别跳过: 截图失败 type=${mediaTarget.type}")
            return MediaUnderstanding(messages, fallbackFor(mediaTarget.type))
        }

        val vision = api.describeVision(token, imageBase64, prompt = prompt)
        if (!vision.success || vision.description.isNullOrBlank()) {
            RuntimeJournal.recovery("视觉识别不可用: ${vision.error ?: "empty"}")
            return MediaUnderstanding(messages, fallbackFor(mediaTarget.type))
        }
        android.util.Log.d(
            "AIA",
            "vision result type=${mediaTarget.type} length=${vision.description.length}"
        )

        val label = when (mediaTarget.type) {
            "exchange" -> "对方发来了以图换图照片，视觉识别："
            "image" -> "对方发送了图片，视觉识别："
            "sticker" -> "对方发送了表情，视觉识别："
            "interaction" -> "对方发起了拍一拍或戳一戳互动，视觉识别："
            "voice" -> "对方发送了语音，截图辅助识别："
            else -> "对方发送了媒体消息，识别结果："
        }
        return MediaUnderstanding(
            replaceLatest(messages, mediaTarget, label + vision.description.trim()),
            null
        )
    }

    private fun replaceLatest(
        messages: List<PlatformAdapter.ChatMessage>,
        target: PlatformAdapter.ChatMessage,
        content: String
    ): List<PlatformAdapter.ChatMessage> {
        val index = messages.indexOfLast { it === target }
            .takeIf { it >= 0 }
            ?: messages.indexOfLast { it == target }
        if (index < 0) return messages
        return messages.toMutableList().also {
            it[index] = target.copy(content = content, type = "text")
        }
    }

    private fun fallbackFor(type: String): String = when (type) {
        "exchange" -> "以图换图没成功 先打字聊吧"
        "voice" -> "语音我这边听不了 以后打字说吧"
        "image" -> "图片我这边看不清 直接打字告诉我吧"
        "sticker" -> "别发表情啦 打字说吧"
        "interaction" -> "拍一拍收到啦 打字说吧"
        else -> "这个我这边看不清 打字说吧"
    }

    private suspend fun requestReply(
        adapter: PlatformAdapter,
        context: ConversationContext,
        messages: List<PlatformAdapter.ChatMessage>,
        api: ApiService,
        token: String,
        leaseToken: String,
        interactionEpoch: Long
    ): String? {
        state = EngineState.WaitingLLM
        val location = withContext(Dispatchers.IO) { repository.getLocation() }
        var requestMessages = messages
        var recalcCount = 0

        runCatching {
            api.registerContact(token, currentPlatform, context.contactId, context.contactName)
        }
            .onSuccess { android.util.Log.d("AIA", "contact sync result=$it") }
            .onFailure { android.util.Log.w("AIA", "contact sync failed: ${it.message}", it) }

        repeat(MAX_LLM_RETRIES) {
            if (!canContinue(leaseToken, interactionEpoch)) return null
            val requestId = synchronized(context) { context.llmRequestId }
            android.util.Log.d(
                "AIA",
                "chat request attempt=${it + 1}/$MAX_LLM_RETRIES contact=${context.contactName} messages=${requestMessages.size}"
            )
            val response = try {
                api.chat(
                    ChatRequest(
                        token = token,
                        platform = currentPlatform,
                        contactId = context.contactId,
                        contactName = context.contactName,
                        messages = requestMessages.map {
                            mapOf(
                                "role" to if (it.sender == "self") "assistant" else "user",
                                "content" to it.content
                            )
                        },
                        location = location
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                android.util.Log.e("AIA", "chat request failed attempt=${it + 1}", error)
                RuntimeJournal.recovery("调用回复接口失败: ${error.message}")
                delay(900)
                return@repeat
            }
            android.util.Log.d(
                "AIA",
                "chat response action=${response.action} replyLength=${response.reply?.length ?: 0} error=${response.error.orEmpty()}"
            )

            if (response.action == "skip") {
                RuntimeJournal.recovery("后端跳过联系人 ${context.contactName}")
                return null
            }
            if (!response.error.isNullOrBlank() || response.reply.isNullOrBlank()) {
                RuntimeJournal.recovery("回复接口未返回有效内容: ${response.error ?: "empty_reply"}")
                delay(900)
                return@repeat
            }

            val decision = ReplyFreshnessPolicy.decide(
                requestId = requestId,
                currentRequestId = synchronized(context) { context.llmRequestId },
                recalcCount = recalcCount,
                firstMessageAtMs = context.firstMessageAt,
                nowMs = System.currentTimeMillis()
            )
            android.util.Log.d("AIA", "reply freshness=$decision recalc=$recalcCount")
            when (decision) {
                ReplyFreshnessDecision.KEEP -> return response.reply.trim()
                ReplyFreshnessDecision.FORCE_SEND -> {
                    if (verifyCurrentChat(adapter, context.contactName)) return response.reply.trim()
                    return null
                }
                ReplyFreshnessDecision.RECOMPUTE -> {
                    recalcCount++
                    val freshRoot = service?.rootInActiveWindow ?: return null
                    if (!verifyCurrentChat(adapter, context.contactName)) return null
                    val freshMessages = adapter.readMessages(freshRoot)
                    if (freshMessages.isNotEmpty()) requestMessages = freshMessages
                    delay(250)
                }
            }
        }
        return null
    }

    private suspend fun sendReply(
        adapter: PlatformAdapter,
        context: ConversationContext,
        reply: String,
        leaseToken: String,
        interactionEpoch: Long
    ): Boolean {
        val sentences = ReplyFormatter.formatForSending(reply)
        if (sentences.isEmpty()) return false

        var sentAny = false

        for ((index, sentence) in sentences.withIndex()) {
            if (!canContinue(leaseToken, interactionEpoch)) {
                clearInputField()
                return sentAny
            }
            if (!verifyCurrentChat(adapter, context.contactName)) {
                RuntimeJournal.messageSent(false, "发送前联系人验证失败")
                return sentAny
            }

            state = EngineState.Sending
            val svc = service ?: return sentAny
            val root = svc.rootInActiveWindow ?: return sentAny
            val result = adapter.fillAndSend(svc, root, sentence, context.contactName)
            if (result != PlatformAdapter.SendResult.SUCCESS) {
                RuntimeJournal.messageSent(false, "发送未完成: $result")
                if (result == PlatformAdapter.SendResult.BANNED) {
                    state = EngineState.Error
                    return sentAny
                }
                clearInputField()
                return sentAny
            }
            RuntimeJournal.messageSent(true, "第${index + 1}/${sentences.size}句")

            sentAny = true

            if (index < sentences.size - 1) {
                delay(Random.nextLong(SPLIT_MIN_MS, SPLIT_MAX_MS))
            }
        }
        return sentAny
    }

    private fun verifyCurrentChat(adapter: PlatformAdapter, expectedContactName: String): Boolean {
        val root = service?.rootInActiveWindow ?: return false
        if (root.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) return false
        return ConversationIdentity.matches(expectedContactName, adapter.readChatTitle(root))
    }

    private suspend fun syncMessages(
        context: ConversationContext,
        messages: List<PlatformAdapter.ChatMessage>
    ) {
        val token = withContext(Dispatchers.IO) { repository.getActiveToken()?.token?.trim() }.orEmpty()
        val baseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
        if (token.isEmpty()) return
        runCatching {
            ApiService(baseUrl).syncMessages(
                token = token,
                platform = currentPlatform,
                contactId = context.contactId,
                contactName = context.contactName,
                messages = messages.map {
                    mapOf(
                        "role" to if (it.sender == "self") "assistant" else "user",
                        "content" to it.content
                    )
                }
            )
        }
    }

    fun onPageChanged(isInChatRoom: Boolean) {
        android.util.Log.d("AIA", "page changed isInChat=$isInChatRoom state=$state")
    }

    fun onNewMessage(platform: String, message: PlatformAdapter.MessageInfo) {
        if (!hostingEnabled || state == EngineState.Paused) return
        RuntimeJournal.notifyReceived(platform, message.sender, message.content)

        val fingerprint = Deduplicator.fingerprint(platform, message.sender + message.content, "")
        if (Deduplicator.isSeenRecent(fingerprint, DEDUP_WINDOW_MS)) return
        Deduplicator.markSeen(fingerprint)

        activeContext?.let { context ->
            if (context.platform == platform) {
                synchronized(context) { context.llmRequestId++ }
            }
        }
        activeContext?.let { context ->
            if (context.platform == platform) {
                synchronized(context) {
                    context.lastIncomingFingerprint = incomingFingerprint(message.content)
                }
            }
        }
        wakeSignal.trySend(Unit)
    }

    fun onContentChanged(platform: String) {
        if (!hostingEnabled || GestureMonitor.isAutomationActionActive()) return
        if (platform != currentPlatform) return
        if (state == EngineState.WaitingLLM || state == EngineState.AboutToSend || state == EngineState.Sending) {
            val context = activeContext ?: return
            val adapter = adapterRegistry?.getByPlatform(platform) ?: return
            val root = service?.rootInActiveWindow ?: return
            if (!adapter.isInChat(root) || !ConversationIdentity.matches(context.contactName, adapter.readChatTitle(root))) return
            val incomingBatch = IncomingMessageBatch.select(adapter.readMessages(root)) ?: return
            val latestIncoming = incomingBatch.latestIncoming
            val fingerprint = incomingFingerprint(latestIncoming)
            synchronized(context) {
                if (fingerprint != context.lastIncomingFingerprint) {
                    context.lastIncomingFingerprint = fingerprint
                    context.llmRequestId++
                    android.util.Log.d("AIA", "new incoming message invalidated current LLM reply")
                }
            }
        }
        wakeSignal.trySend(Unit)
    }

    fun onUserInteraction() {
        if (!GestureMonitor.onTouchDetected()) return
        android.util.Log.d("AIA", "manual takeover detected, state=$state")
        if (state == EngineState.AboutToSend || state == EngineState.Sending || state == EngineState.WaitingLLM) {
            clearInputField()
        }
        state = EngineState.Paused
    }

    @Synchronized
    private fun getOrCreateContext(platform: String, contactId: String): ConversationContext {
        return contexts.getOrPut("$platform:$contactId") {
            ConversationContext(platform, contactId, firstMessageAt = System.currentTimeMillis())
        }
    }

    private fun incomingFingerprint(message: PlatformAdapter.ChatMessage): String {
        return IncomingMessageTracker.fingerprint(message.content)
    }

    private fun incomingFingerprint(content: String): String {
        return IncomingMessageTracker.fingerprint(content)
    }

    private fun canContinue(leaseToken: String, interactionEpoch: Long?): Boolean {
        if (!hostingEnabled || !lease.renew(leaseToken)) return false
        if (interactionEpoch != null && GestureMonitor.interactionEpoch() != interactionEpoch) return false
        return !GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS)
    }

    private fun clearInputField() {
        val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return
        if (adapter !is SoulAdapter) return
        scope.launch {
            runCatching { adapter.clearInput() }
        }
    }

    fun currentState(): EngineState = state

    fun shutdown() {
        stopHosting()
        scope.cancel()
    }

    private data class MediaUnderstanding(
        val messages: List<PlatformAdapter.ChatMessage>,
        val fallbackReply: String?
    )

    companion object {
        const val POLL_INTERVAL_MS = 3_000L
        const val USER_PAUSE_MS = 5_000L
        const val DEDUP_WINDOW_MS = 5 * 60 * 1000L
        const val MAX_CHAT_WAIT_RETRIES = 5
        const val READ_MESSAGE_RETRIES = 4
        const val MAX_LLM_RETRIES = 3
        const val SPLIT_MIN_MS = 1_000L
        const val SPLIT_MAX_MS = 2_000L
    }
}
