package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulAdapter
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.network.ApiService
import com.aaiagent.network.ChatRequest
import com.aaiagent.network.ReplyTask
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
    private var lastBackendTaskPollAt: Long = 0L
    private var lastSyncFlushAt: Long = 0L

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
            maybeFlushSyncOutbox()
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

        val now = System.currentTimeMillis()
        if (hostingMode != HostingMode.MONITOR_ONLY &&
            BackendTaskPollPolicy.isDue(lastBackendTaskPollAt, now, BACKEND_TASK_POLL_INTERVAL_MS)
        ) {
            lastBackendTaskPollAt = now
            if (processBackendReplyTask(svc, adapter, leaseToken)) return
        }

        val activeRoot = svc.rootInActiveWindow
        if (activeRoot?.packageName?.toString() == adapter.packageName && adapter.isInChat(activeRoot)) {
            val title = adapter.readChatTitle(activeRoot)
            if (!title.isNullOrBlank()) {
                if (isContactAllowed(title, title)) {
                    processVerifiedChat(adapter, activeRoot, title, title, leaseToken)
                } else {
                    returnToMessageList(adapter, leaseToken, "contact filtered")
                }
                return
            }
        }

        state = EngineState.ScanningConversations
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            state = EngineState.Idle
            return
        }
        if (!canContinue(leaseToken, null)) return

        val info = adapter.clickFirstUnreadConversation(
            listRoot,
            shouldClick = true,
            contactFilter = ::isContactAllowed
        )
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

    private suspend fun processBackendReplyTask(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        leaseToken: String
    ): Boolean {
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isEmpty()) return false
        val apiBaseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
        val task = try {
            ApiService(apiBaseUrl).getNextReplyTask(token, currentPlatform)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            android.util.Log.w("AIA", "reply task fetch failed: ${error.message}", error)
            return false
        } ?: return false

        return when (ReplyTaskPolicy.decide(task.type, task.platform, currentPlatform)) {
            ReplyTaskAction.SEND_EXACT -> processManualReplyTask(svc, adapter, task, leaseToken, apiBaseUrl, token)
            ReplyTaskAction.PROCESS_AI -> processPriorityContactTask(svc, adapter, task, leaseToken)
            ReplyTaskAction.IGNORE -> false
        }
    }

    private suspend fun processManualReplyTask(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        task: ReplyTask,
        leaseToken: String,
        apiBaseUrl: String,
        deviceToken: String
    ): Boolean {
        val content = task.content?.trim().orEmpty()
        if (content.isEmpty()) {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "empty_content")
            return true
        }
        if (!isContactAllowed(task.contactName, task.contactId)) {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "contact_filtered")
            return true
        }
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "message_list_unavailable")
            return true
        }
        val conversation = adapter.clickConversationByName(listRoot, task.contactName, true) ?: run {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "contact_not_found")
            return true
        }
        RuntimeJournal.clickConversation(conversation.contactName, true)
        val chatRoot = waitForVerifiedChat(svc, adapter, conversation.contactName, leaseToken) ?: run {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "chat_verification_failed")
            return true
        }
        if (!isContactAllowed(conversation.contactName, conversation.contactId)) {
            reportReplyTask(apiBaseUrl, deviceToken, task.taskId, "failed", "contact_filtered")
            returnToMessageList(adapter, leaseToken, "manual task contact filtered")
            return true
        }
        if (!canContinue(leaseToken, null)) return true

        state = EngineState.Sending
        val result = adapter.fillAndSend(svc, chatRoot, content, conversation.contactName)
        val status = if (result == PlatformAdapter.SendResult.SUCCESS) "sent" else "failed"
        val error = if (status == "sent") "" else "send_result_$result"
        reportReplyTask(apiBaseUrl, deviceToken, task.taskId, status, error)
        RuntimeJournal.messageSent(status == "sent", "后台人工消息 ${conversation.contactName}")
        if (status == "sent") {
            synchronized(getOrCreateContext(currentPlatform, conversation.contactId)) {
                getOrCreateContext(currentPlatform, conversation.contactId).aiSentContents.add(content)
            }
            returnToMessageList(adapter, leaseToken, "manual reply sent")
        }
        return true
    }

    private suspend fun processPriorityContactTask(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        task: ReplyTask,
        leaseToken: String
    ): Boolean {
        if (!isContactAllowed(task.contactName, task.contactId)) return true
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: return true
        val conversation = adapter.clickConversationByName(listRoot, task.contactName, true) ?: return false
        RuntimeJournal.clickConversation(conversation.contactName, true)
        val chatRoot = waitForVerifiedChat(svc, adapter, conversation.contactName, leaseToken) ?: return true
        processVerifiedChat(adapter, chatRoot, conversation.contactId, conversation.contactName, leaseToken)
        return true
    }

    private suspend fun reportReplyTask(
        apiBaseUrl: String,
        token: String,
        taskId: String?,
        status: String,
        error: String
    ) {
        if (taskId.isNullOrBlank()) return
        withContext(Dispatchers.IO) {
            runCatching { ApiService(apiBaseUrl).reportReplyTask(token, taskId, status, error) }
        }
    }

    private suspend fun processVerifiedChat(
        adapter: PlatformAdapter,
        chatRoot: AccessibilityNodeInfo,
        contactId: String,
        contactName: String,
        leaseToken: String
    ) {
        if (!isContactAllowed(contactName, contactId)) {
            RuntimeJournal.recovery("联系人策略跳过 contact=$contactName")
            returnToMessageList(adapter, leaseToken, "contact filtered")
            return
        }
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
            // Soul 互动表情本地识别
            if (adapter is com.aaiagent.adapter.SoulAdapter) {
                messages = adapter.recognizePendingStickers(messages)
            }
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) returnToMessageList(adapter, leaseToken, "empty chat")
                return
            }
            enqueueSnapshot(context, messages)

            val lastMessage = messages.lastOrNull() ?: return
            if (!ConversationReplyPolicy.shouldReply(lastMessage.sender)) {
                android.util.Log.d("AIA", "conversation has no unanswered incoming message")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) returnToMessageList(adapter, leaseToken, "no unanswered incoming message")
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
                returnToMessageList(adapter, leaseToken, "duplicate batch")
                return
            }
            synchronized(context) {
                context.lastIncomingFingerprint = incomingFingerprint(latestIncoming)
            }
            if (hostingMode == HostingMode.MONITOR_ONLY) {
                synchronized(context) {
                    context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                }
                returnToMessageList(adapter, leaseToken, "monitor batch recorded")
                return
            }
            val localMediaReply = LocalMediaReplyPolicy.replyFor(incomingBatch)
            if (localMediaReply != null) {
                android.util.Log.d(
                    "AIA",
                    "local media reply type=${incomingBatch.mediaTarget?.type ?: "voice"}"
                )
            }
            val reply = localMediaReply ?: run {
                val token = withContext(Dispatchers.IO) {
                    repository.getActiveToken()?.token?.trim()
                }.orEmpty()
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
                    messages = incomingBatch.incoming,
                    incomingBatch = incomingBatch,
                    api = api,
                    token = token,
                    leaseToken = leaseToken,
                    interactionEpoch = interactionEpoch,
                    expectedContactName = context.contactName
                )
                messages = understanding.messages

                requestReply(
                    adapter = adapter,
                    context = context,
                    messages = messages,
                    api = api,
                    token = token,
                    leaseToken = leaseToken,
                    interactionEpoch = interactionEpoch
                ) ?: return
            }

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
                            state = EngineState.ScanningConversations
                            returnToMessageList(adapter, leaseToken, "reply sent")
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
        interactionEpoch: Long,
        expectedContactName: String
    ): MediaUnderstanding {
        val mediaTarget = incomingBatch.mediaTarget ?: return MediaUnderstanding(messages)
        if (mediaTarget.type == "text" || mediaTarget.type == "unknown" || mediaTarget.type == "voice_emoji") {
            return MediaUnderstanding(messages)
        }

        val svc = service ?: return MediaUnderstanding(messages)
        if (!canContinue(leaseToken, interactionEpoch)) return MediaUnderstanding(messages)
        android.util.Log.d("AIA", "media understanding start type=${mediaTarget.type}")

        if (mediaTarget.type == "voice") {
            val result = adapter.transcribeIncomingVoices(root)
            android.util.Log.d(
                "AIA",
                "voice transcription total=${result.total} transcribed=${result.transcribed}"
            )
            if (result.hasAny) {
                val refreshed = adapter.readMessages(svc.rootInActiveWindow ?: root)
                return MediaUnderstanding(IncomingMessageBatch.select(refreshed)?.incoming ?: messages)
            }
        }

        val prompt = ImageUnderstandingPolicy.VISION_PROMPT
        val preparation = adapter.prepareVisualCapture(root, mediaTarget.type)
        if (preparation == null) {
            RuntimeJournal.recovery("隐私图片展开失败 type=${mediaTarget.type}")
            return MediaUnderstanding(messages)
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
        if (restoreAfterVisualCapture(
                svc = svc,
                adapter = adapter,
                expectedContactName = expectedContactName,
                leaseToken = leaseToken,
                interactionEpoch = interactionEpoch
            ) == null
        ) {
            return MediaUnderstanding(messages)
        }
        if (imageBase64.isNullOrEmpty()) {
            if (PrivacyPhotoPolicy.shouldUseModelContext(
                    privacyProtected = preparation.privacyProtected,
                    captureAvailable = false
                )
            ) {
                return MediaUnderstanding(
                    replaceLatest(messages, mediaTarget, PrivacyPhotoPolicy.MODEL_CONTEXT)
                )
            }
            RuntimeJournal.recovery("视觉识别跳过: 截图失败 type=${mediaTarget.type}")
            return MediaUnderstanding(messages)
        }

        val vision = api.describeVision(token, imageBase64, prompt = prompt)
        if (!vision.success || vision.description.isNullOrBlank()) {
            RuntimeJournal.recovery("视觉识别不可用: ${vision.error ?: "empty"}")
            return MediaUnderstanding(messages)
        }
        android.util.Log.d(
            "AIA",
            "vision result type=${mediaTarget.type} length=${vision.description.length}"
        )

        return MediaUnderstanding(
            replaceLatest(
                messages,
                mediaTarget,
                ImageUnderstandingPolicy.modelFacts(mediaTarget.type, vision.description)
            )
        )
    }

    private suspend fun restoreAfterVisualCapture(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        expectedContactName: String,
        leaseToken: String,
        interactionEpoch: Long
    ): AccessibilityNodeInfo? {
        repeat(VISUAL_RETURN_RETRIES) { attempt ->
            if (!canContinue(leaseToken, interactionEpoch)) return null
            val root = svc.rootInActiveWindow
            if (root?.packageName?.toString() == adapter.packageName && adapter.isInChat(root)) {
                if (ConversationIdentity.matches(expectedContactName, adapter.readChatTitle(root))) {
                    android.util.Log.d("AIA", "visual capture returned to verified chat")
                    return root
                }
            }
            if (attempt < VISUAL_RETURN_RETRIES - 1) {
                if (root?.packageName?.toString() == adapter.packageName) {
                    svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                } else {
                    adapter.bringToForeground(svc)
                }
                delay(650)
            }
        }
        RuntimeJournal.recovery("媒体处理后未回到联系人聊天页: $expectedContactName")
        return null
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
                            mapOf<String, Any>(
                                "role" to if (it.sender == "self") "assistant" else "user",
                                "content" to it.content,
                                "timestamp" to it.timestampText,
                                "created_at" to (it.timestampMillis?.div(1000L) ?: 0L)
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
                    val freshIncoming = IncomingMessageBatch.select(freshMessages)?.incoming
                    if (!freshIncoming.isNullOrEmpty()) requestMessages = freshIncoming
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
        val outgoing = AssistantReplySanitizer.clean(reply)
        if (outgoing.isEmpty()) return false

        // 代码层做"真人打字感"：按行拆成短段，去掉句末句号/逗号/～，逐段发，段间随机等几秒。
        val segments = outgoing.split(Regex("\\r?\\n|\\|\\|\\|"))
            .map { it.trim().trimEnd('。', '，', ',', '.', '~', '～').trim() }
            .filter { it.isNotEmpty() && it.length <= 60 }
        val parts = if (segments.isNotEmpty()) segments else listOf(outgoing.trimEnd('。', '，', '~', '～'))
        android.util.Log.d("AIA", "outgoing reply sanitized segments=${parts.size} length=${outgoing.length}")

        var sentAny = false
        for ((index, part) in parts.withIndex()) {
            if (!canContinue(leaseToken, interactionEpoch)) { clearInputField(); break }
            if (!verifyCurrentChat(adapter, context.contactName)) { RuntimeJournal.messageSent(false, "发送前联系人验证失败"); break }
            if (index > 0) delay((1000L..3000L).random())
            state = EngineState.Sending
            val svc = service ?: break
            val root = svc.rootInActiveWindow ?: break
            val result = adapter.fillAndSend(svc, root, part, context.contactName)
            if (result != PlatformAdapter.SendResult.SUCCESS) {
                RuntimeJournal.messageSent(false, "发送未完成: $result")
                if (result == PlatformAdapter.SendResult.BANNED) { state = EngineState.Error }
                clearInputField()
                break
            }
            sentAny = true
        }
        if (sentAny) {
            RuntimeJournal.messageSent(true, "回复发送")
            synchronized(context) { context.aiSentContents.add(outgoing) }
        }
        return sentAny
    }

    private fun verifyCurrentChat(adapter: PlatformAdapter, expectedContactName: String): Boolean {
        val root = service?.rootInActiveWindow ?: return false
        if (root.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) return false
        return ConversationIdentity.matches(expectedContactName, adapter.readChatTitle(root))
    }

    private suspend fun enqueueSnapshot(
        context: ConversationContext,
        messages: List<PlatformAdapter.ChatMessage>
    ) {
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isEmpty() || messages.isEmpty()) return

        val automatedReplies = synchronized(context) { context.aiSentContents.toSet() }
        val stateId = listOf(token, currentPlatform, context.contactId).joinToString("\u0000")
        val inserted = withContext(Dispatchers.IO) {
            repository.cleanOldCache()
            val previousState = repository.getConversationSyncState(stateId)
            val previousSnapshot = SyncSnapshotCodec.decode(previousState?.snapshotJson)
            val currentSnapshot = messages.mapNotNull { message ->
                val role = if (message.sender == "self") "assistant" else "user"
                val content = message.content.trim()
                if (content.isEmpty()) null else SyncSnapshotItem(
                    role = role,
                    content = content,
                    createdAt = message.timestampMillis?.div(1000L)
                )
            }
            val newIndexes = SyncSnapshotPolicy.selectNewItems(previousSnapshot, currentSnapshot)
            var sequence = previousState?.nextSequence ?: 0L
            val outbox = mutableListOf<MessageSyncOutboxEntity>()
            for (index in newIndexes) {
                val item = currentSnapshot[index]
                sequence++
                if (item.role == "assistant" && item.content in automatedReplies) continue
                val id = SyncMessageKey.build(
                    platform = currentPlatform,
                    contactId = context.contactId,
                    role = item.role,
                    content = item.content,
                    sequence = sequence
                )
                outbox += MessageSyncOutboxEntity(
                    id = id,
                    token = token,
                    platform = currentPlatform,
                    contactId = context.contactId,
                    contactName = context.contactName,
                    role = item.role,
                    content = item.content,
                    source = if (item.role == "assistant") "human_phone" else "sync",
                    createdAt = item.createdAt ?: (System.currentTimeMillis() / 1000)
                )
            }
            val state = ConversationSyncStateEntity(
                id = stateId,
                platform = currentPlatform,
                contactId = context.contactId,
                snapshotJson = SyncSnapshotCodec.encode(currentSnapshot),
                nextSequence = sequence
            )
            repository.persistSyncSnapshot(state, outbox)
        }
        if (inserted >= SYNC_BATCH_SIZE) maybeFlushSyncOutbox(force = true)
    }

    private suspend fun maybeFlushSyncOutbox(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastSyncFlushAt < SYNC_FLUSH_INTERVAL_MS) return
        lastSyncFlushAt = now
        val pending = withContext(Dispatchers.IO) { repository.pendingSyncMessages(now, 100) }
        if (pending.isEmpty()) return
        val baseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
        val api = ApiService(baseUrl)
        pending.groupBy { Triple(it.token, it.platform, it.contactId) }.values.forEach { group ->
            val first = group.first()
            val success = runCatching {
                api.syncMessages(
                    token = first.token,
                    platform = first.platform,
                    contactId = first.contactId,
                    contactName = first.contactName,
                    messages = group.map {
                        mapOf<String, Any>(
                            "message_key" to it.id,
                            "role" to it.role,
                            "content" to it.content,
                            "source" to it.source,
                            "created_at" to it.createdAt
                        )
                    }
                )
            }.getOrDefault(false)
            val ids = group.map { it.id }
            withContext(Dispatchers.IO) {
                if (success) {
                    repository.deleteSyncMessages(ids)
                } else {
                    val attempts = group.maxOf { it.attempts } + 1
                    val backoff = minOf(300_000L, 1_000L shl minOf(attempts, 8))
                    repository.markSyncMessagesFailed(ids, now + backoff)
                }
            }
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


    private suspend fun returnToMessageList(
        adapter: PlatformAdapter,
        leaseToken: String,
        reason: String
    ) {
        if (!HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode) || !canContinue(leaseToken, null)) return
        val svc = service ?: return
        val currentRoot = svc.rootInActiveWindow ?: return
        state = EngineState.ScanningConversations
        adapter.navigateToMessageList(svc, currentRoot)
        android.util.Log.d("AIA", "returned to message list reason=$reason")
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

    private suspend fun isContactAllowed(contactName: String?, contactId: String?): Boolean {
        val filters = withContext(Dispatchers.IO) {
            repository.getContactWhitelist() to repository.getContactBlacklist()
        }
        return ContactFilterPolicy.allowsContact(
            contactName = contactName,
            contactId = contactId,
            whitelist = filters.first,
            blacklist = filters.second
        )
    }

    fun shutdown() {
        stopHosting()
        scope.cancel()
    }

    private data class MediaUnderstanding(
        val messages: List<PlatformAdapter.ChatMessage>
    )

    companion object {
        const val POLL_INTERVAL_MS = 3_000L
        const val BACKEND_TASK_POLL_INTERVAL_MS = 30_000L
        const val USER_PAUSE_MS = 5_000L
        const val DEDUP_WINDOW_MS = 5 * 60 * 1000L
        const val SYNC_BATCH_SIZE = 10
        const val SYNC_FLUSH_INTERVAL_MS = 10_000L
        const val MAX_CHAT_WAIT_RETRIES = 5
        const val READ_MESSAGE_RETRIES = 4
        const val VISUAL_RETURN_RETRIES = 4
        const val MAX_LLM_RETRIES = 3
    }
}
