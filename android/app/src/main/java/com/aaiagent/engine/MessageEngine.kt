package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulAdapter
import com.aaiagent.adapter.SoulMediaType
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
import java.util.UUID

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

private data class ReplySuggestion(
    val content: String,
    val replyId: String?
)

class MessageEngine(
    private val service: AccessibilityService?,
    private val repository: AppRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val adapterRegistry: AdapterRegistry? = service?.let { AdapterRegistry(it) }
    private val lease = AutomationLease()
    private val wakeSignal = Channel<Unit>(Channel.CONFLATED)
    private val contexts = mutableMapOf<String, ConversationContext>()
    private val handledConversationIds = mutableSetOf<String>()
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
        android.util.Log.d("AIA", "HostingStarted platform=$platform mode=$hostingMode")
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
        handledConversationIds.clear()
        contexts.values.forEach(::clearPendingReply)
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
                var processedConversation = false
                try {
                    processedConversation = scanAndProcess(leaseToken)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    android.util.Log.e("AIA", "hosting loop crashed", error)
                    RuntimeJournal.recovery("托管循环异常: ${error.message}")
                    state = EngineState.Error
                }

                if (processedConversation) continue
            }

            val wokeEarly = withTimeoutOrNull(POLL_INTERVAL_MS) {
                wakeSignal.receive()
            } != null
            handledConversationIds.clear()
            android.util.Log.d("AIA", "message-list round complete wokeEarly=$wokeEarly")
        }

        if (hostingEnabled && !lease.owns(leaseToken)) {
            android.util.Log.w("AIA", "hosting loop stopped because lease was revoked")
        }
    }

    private suspend fun scanAndProcess(leaseToken: String): Boolean {
        if (!canContinue(leaseToken, null)) return false
        val svc = service ?: run {
            state = EngineState.Error
            return false
        }
        val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return false

        if (!HostingCompletionPolicy.canPerformScreenActions(hostingMode)) {
            val root = svc.rootInActiveWindow
            if (root?.packageName?.toString() == adapter.packageName && adapter.isInChat(root)) {
                recordCurrentChatOnly(adapter, root, leaseToken)
            }
            state = EngineState.Idle
            return false
        }

        val now = System.currentTimeMillis()
        if (hostingMode != HostingMode.MONITOR_ONLY &&
            BackendTaskPollPolicy.isDue(lastBackendTaskPollAt, now, BACKEND_TASK_POLL_INTERVAL_MS)
        ) {
            lastBackendTaskPollAt = now
            if (processBackendReplyTask(svc, adapter, leaseToken)) return true
        }

        val activeRoot = svc.rootInActiveWindow
        if (activeRoot?.packageName?.toString() == adapter.packageName && adapter.isInChat(activeRoot)) {
            val title = adapter.readChatTitle(activeRoot)
            if (!title.isNullOrBlank()) {
                if (isContactAllowed(title, title)) {
                    markHandled(title)
                    processVerifiedChat(adapter, activeRoot, title, title, leaseToken)
                } else {
                    markHandled(title)
                    returnToMessageList(adapter, leaseToken, "contact filtered")
                }
                return true
            }
        }

        state = EngineState.ScanningConversations
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            state = EngineState.Idle
            return false
        }
        if (!canContinue(leaseToken, null)) return false

        val info = adapter.clickFirstUnreadConversation(
            listRoot,
            shouldClick = true,
            contactFilter = { contactName, contactId ->
                !isHandled(contactId) && isContactAllowed(contactName, contactId)
            }
        )
        if (info == null) {
            state = EngineState.Idle
            return false
        }
        RuntimeJournal.clickConversation(info.contactName, true)

        val verifiedChat = waitForVerifiedChat(svc, adapter, info.contactName, leaseToken)
        if (verifiedChat == null) {
            markHandled(info.contactId)
            state = EngineState.Idle
            return true
        }

        processVerifiedChat(adapter, verifiedChat, info.contactId, info.contactName, leaseToken)
        markHandled(info.contactId)
        return true
    }

    /**
     * Monitor-only mode is strictly read-only. It never opens, clicks, scrolls,
     * fills, clears, sends, or navigates away from the page the user is viewing.
     */
    private suspend fun recordCurrentChatOnly(
        adapter: PlatformAdapter,
        chatRoot: AccessibilityNodeInfo,
        leaseToken: String
    ) {
        if (hostingMode != HostingMode.MONITOR_ONLY || !canContinue(leaseToken, null)) return
        val contactName = adapter.readChatTitle(chatRoot)?.trim().orEmpty()
        if (contactName.isBlank() || !isContactAllowed(contactName, contactName)) return

        val context = getOrCreateContext(currentPlatform, contactName).also {
            it.contactName = contactName
            activeContext = it
        }
        state = EngineState.ReadingMessages
        try {
            var messages = readMessagesWithRetry(adapter, chatRoot, contactName, leaseToken)
            if (adapter is SoulAdapter) {
                messages = adapter.recognizePendingStickers(messages).messages
            }
            if (messages.isEmpty()) return

            enqueueSnapshot(context, messages)
            synchronized(context) {
                context.lastIncomingFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(messages)
            }
            RuntimeJournal.readMessages(messages.size, messages.lastOrNull()?.content.orEmpty())
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            RuntimeJournal.recovery("仅记录读取当前聊天异常: ${error.message}")
            android.util.Log.e("AIA", "monitor-only read failed", error)
        } finally {
            activeContext = null
            state = EngineState.Idle
        }
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
        val conversationStartedAt = System.currentTimeMillis()
        state = EngineState.ReadingMessages
        RuntimeJournal.stateChange("Idle", "ReadingMessages")

        try {
            var root = chatRoot
            var messages = readMessagesWithRetry(adapter, root, context.contactName, leaseToken)
            // Soul 互动表情本地识别
            var failedStickerIndexes = emptySet<Int>()
            if (adapter is com.aaiagent.adapter.SoulAdapter) {
                val recognition = adapter.recognizePendingStickers(messages)
                messages = recognition.messages
                failedStickerIndexes = recognition.failedIndexes
            }
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) returnToMessageList(adapter, leaseToken, "empty chat")
                return
            }
            android.util.Log.d(
                "AIA",
                "chat_timing stage=read elapsed=${System.currentTimeMillis() - conversationStartedAt} messages=${messages.size}"
            )
            enqueueSnapshot(context, messages)
            val deliveryFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(messages)

            val outstandingReplyId = synchronized(context) { context.pendingReplyId }
            val pendingParts = synchronized(context) { context.pendingReplyParts.toList() }
            if (pendingParts.isEmpty() && outstandingReplyId.isNotBlank()) {
                if (confirmPendingReply(context)) {
                    synchronized(context) {
                        if (context.pendingReplyBatchFingerprint.isNotBlank()) {
                            context.lastRepliedIncomingFingerprint = context.pendingReplyBatchFingerprint
                        }
                    }
                    clearPendingReply(context)
                } else {
                    android.util.Log.w("AIA", "reply confirmation still pending replyId=$outstandingReplyId")
                    returnToMessageList(adapter, leaseToken, "reply confirmation retry")
                    return
                }
            }
            if (pendingParts.isNotEmpty() && hostingMode == HostingMode.FULL_AUTO) {
                val pendingFingerprint = synchronized(context) {
                    context.pendingReplyIncomingFingerprint
                }
                val pendingBatchFingerprint = synchronized(context) {
                    context.pendingReplyBatchFingerprint
                }
                if (ReplyDeliveryPolicy.incomingChanged(pendingFingerprint, deliveryFingerprint)) {
                    clearPendingReply(context)
                    android.util.Log.d("AIA", "pending reply invalidated by newer incoming messages")
                    return
                }
                state = EngineState.AboutToSend
                val delivery = deliverReplyParts(
                    adapter = adapter,
                    context = context,
                    parts = pendingParts,
                    expectedIncomingFingerprint = pendingFingerprint,
                    leaseToken = leaseToken,
                    interactionEpoch = interactionEpoch
                )
                if (delivery.isComplete && delivery.confirmed) {
                    synchronized(context) {
                        if (pendingBatchFingerprint.isNotBlank()) {
                            context.lastRepliedIncomingFingerprint = pendingBatchFingerprint
                        }
                    }
                    clearPendingReply(context)
                    if (HostingCompletionPolicy.shouldReturnToMessageList(
                            mode = hostingMode,
                            sentAny = true,
                            automationStillOwned = canContinue(leaseToken, interactionEpoch)
                        )
                    ) {
                        state = EngineState.ScanningConversations
                        returnToMessageList(adapter, leaseToken, "pending reply sent")
                    }
                } else if (delivery.isComplete) {
                    android.util.Log.w("AIA", "reply sent but backend confirmation failed; retry on next scan")
                }
                if (delivery.status == ReplyDeliveryStatus.STALE) clearPendingReply(context)
                return
            }

            val lastMessage = messages.lastOrNull() ?: return
            if (!ConversationReplyPolicy.shouldReply(lastMessage.sender)) {
                android.util.Log.d("AIA", "conversation has no unanswered incoming message")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) returnToMessageList(adapter, leaseToken, "no unanswered incoming message")
                return
            }
            val incomingBatch = IncomingMessageBatch.select(messages) ?: return
            if (failedStickerIndexes.any { index -> messages.getOrNull(index) in incomingBatch.incoming }) {
                RuntimeJournal.recovery("互动表情截图失败，保留聊天页下次重试")
                delay(1_000)
                state = EngineState.Idle
                return
            }
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
                context.lastIncomingFingerprint = deliveryFingerprint
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
            val reply = if (localMediaReply != null) {
                ReplySuggestion(localMediaReply, null)
            } else run {
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
                if (understanding.retryInPlace) {
                    RuntimeJournal.recovery("媒体加载未完成，保留聊天页下次重试: ${understanding.reason}")
                    delay(1_000)
                    state = EngineState.Idle
                    return
                }

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
                    val delivery = sendReply(
                        adapter = adapter,
                        context = context,
                        reply = reply.content,
                        replyId = reply.replyId,
                        incomingBatchFingerprint = incomingBatchFingerprint,
                        deliveryFingerprint = deliveryFingerprint,
                        leaseToken = leaseToken,
                        interactionEpoch = interactionEpoch
                    )
                    if (delivery.isComplete && delivery.confirmed) {
                        synchronized(context) {
                            context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                        }
                        clearPendingReply(context)
                        if (HostingCompletionPolicy.shouldReturnToMessageList(
                                mode = hostingMode,
                                sentAny = true,
                                automationStillOwned = canContinue(leaseToken, interactionEpoch)
                            )
                        ) {
                            state = EngineState.ScanningConversations
                            returnToMessageList(adapter, leaseToken, "reply sent")
                        }
                    } else if (delivery.isComplete) {
                        android.util.Log.w("AIA", "reply sent but backend confirmation failed; retry on next scan")
                    } else if (delivery.status == ReplyDeliveryStatus.STALE) {
                        clearPendingReply(context)
                        android.util.Log.d("AIA", "reply delivery stopped because newer messages arrived")
                    }
                }
                HostingMode.SEMI_AUTO -> {
                    if (adapter is SoulAdapter) {
                        if (adapter.fillInputOnly(reply.content, context.contactName)) {
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
        if (mediaTarget.type == "text" ||
            mediaTarget.type == "unknown" ||
            mediaTarget.type == SoulMediaType.VOICE_EMOJI ||
            mediaTarget.type == SoulMediaType.STICKER
        ) {
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
            return MediaUnderstanding(messages, retryInPlace = true, reason = "图片展开失败")
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
            return MediaUnderstanding(messages, retryInPlace = true, reason = "视觉页面返回失败")
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
            return MediaUnderstanding(messages, retryInPlace = true, reason = "截图失败")
        }

        val vision = api.describeVision(token, imageBase64, prompt = prompt)
        if (!vision.success || vision.description.isNullOrBlank()) {
            RuntimeJournal.recovery("视觉识别不可用: ${vision.error ?: "empty"}")
            return MediaUnderstanding(messages, retryInPlace = true, reason = "视觉接口失败")
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
    ): ReplySuggestion? {
        state = EngineState.WaitingLLM
        val requestStartedAt = System.currentTimeMillis()
        val location = withContext(Dispatchers.IO) { repository.getLocation() }
        var requestMessages = messages
        var recalcCount = 0
        var requestId = UUID.randomUUID().toString()

        runCatching {
            api.registerContact(token, currentPlatform, context.contactId, context.contactName)
        }
            .onSuccess { android.util.Log.d("AIA", "contact sync result=$it") }
            .onFailure { android.util.Log.w("AIA", "contact sync failed: ${it.message}", it) }

        repeat(MAX_LLM_RETRIES) {
            if (!canContinue(leaseToken, interactionEpoch)) return null
            val freshnessRequestId = synchronized(context) { context.llmRequestId }
            android.util.Log.d(
                "AIA",
                "chat request attempt=${it + 1}/$MAX_LLM_RETRIES contact=${context.contactName} messages=${requestMessages.size} requestId=$requestId"
            )
            val response = try {
                api.chat(
                    ChatRequest(
                        token = token,
                        platform = currentPlatform,
                        requestId = requestId,
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
                requestId = freshnessRequestId,
                currentRequestId = synchronized(context) { context.llmRequestId },
                recalcCount = recalcCount,
                firstMessageAtMs = context.firstMessageAt,
                nowMs = System.currentTimeMillis()
            )
            android.util.Log.d("AIA", "reply freshness=$decision recalc=$recalcCount")
            when (decision) {
                ReplyFreshnessDecision.KEEP -> {
                    android.util.Log.d(
                        "AIA",
                        "chat_timing stage=llm elapsed=${System.currentTimeMillis() - requestStartedAt} replyId=${response.replyId.orEmpty()}"
                    )
                    return ReplySuggestion(response.reply.trim(), response.replyId)
                }
                ReplyFreshnessDecision.ABORT_STALE -> {
                    android.util.Log.d("AIA", "discard stale reply and wait for newest messages")
                    return null
                }
                ReplyFreshnessDecision.RECOMPUTE -> {
                    recalcCount++
                    requestId = UUID.randomUUID().toString()
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
        replyId: String?,
        incomingBatchFingerprint: String,
        deliveryFingerprint: String,
        leaseToken: String,
        interactionEpoch: Long
    ): ReplyDeliveryResult {
        val outgoing = AssistantReplySanitizer.clean(reply)
        if (outgoing.isEmpty()) return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 0)

        val segments = outgoing.split(Regex("\\r?\\n|\\|\\|\\|"))
            .map { it.trim().trimEnd('。', '，', ',', '.', '~', '～').trim() }
            .filter { it.isNotEmpty() && it.length <= 60 }
        val rawParts = if (segments.isNotEmpty()) segments else listOf(outgoing.trimEnd('。', '，', '~', '～'))
        val parts = ReplyDeliveryPolicy.prepareParts(ReplyDeliveryPolicy.expandLongReply(rawParts))
        if (parts.isEmpty()) return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 0)
        android.util.Log.d("AIA", "outgoing reply sanitized segments=${parts.size} length=${outgoing.length}")

        synchronized(context) {
            context.pendingReplyParts.clear()
            context.pendingReplyParts.addAll(parts)
            context.pendingReplyId = replyId.orEmpty()
            context.pendingReplyIncomingFingerprint = deliveryFingerprint
            context.pendingReplyBatchFingerprint = incomingBatchFingerprint
        }
        return deliverReplyParts(
            adapter = adapter,
            context = context,
            parts = parts,
            expectedIncomingFingerprint = deliveryFingerprint,
            leaseToken = leaseToken,
            interactionEpoch = interactionEpoch
        )
    }

    private suspend fun deliverReplyParts(
        adapter: PlatformAdapter,
        context: ConversationContext,
        parts: List<String>,
        expectedIncomingFingerprint: String,
        leaseToken: String,
        interactionEpoch: Long
    ): ReplyDeliveryResult {
        if (parts.isEmpty()) return ReplyDeliveryResult(ReplyDeliveryStatus.COMPLETE, 0, 0)

        var sentCount = 0
        var replyConfirmed = true
        val deliveryStartedAt = System.currentTimeMillis()
        for ((index, part) in parts.withIndex()) {
            if (!canContinue(leaseToken, interactionEpoch)) {
                clearInputField()
                clearPendingReply(context)
                return ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, sentCount, parts.size)
            }
            if (index > 0) delay(ReplyDeliveryPolicy.delayAfterPart(part))
            if (!incomingStillCurrent(adapter, context, expectedIncomingFingerprint)) {
                android.util.Log.d("AIA", "reply delivery invalidated before part=${index + 1}")
                clearInputField()
                clearPendingReply(context)
                return ReplyDeliveryResult(ReplyDeliveryStatus.STALE, sentCount, parts.size)
            }
            if (!verifyCurrentChatWithRetry(adapter, context.contactName)) {
                RuntimeJournal.messageSent(false, "发送前联系人验证失败")
                clearInputField()
                if (!reopenConversationForDelivery(adapter, context, leaseToken)) {
                    break
                }
            }
            state = EngineState.Sending
            val svc = service ?: break
            val root = svc.rootInActiveWindow ?: break
            val result = adapter.fillAndSend(svc, root, part, context.contactName)
            if (result != PlatformAdapter.SendResult.SUCCESS) {
                RuntimeJournal.messageSent(false, "发送未完成: $result")
                if (result == PlatformAdapter.SendResult.BANNED) {
                    state = EngineState.Error
                    clearPendingReply(context)
                }
                clearInputField()
                break
            }
            sentCount++
            synchronized(context) { context.aiSentContents.add(part) }
        }

        val remaining = ReplyDeliveryPolicy.remaining(parts, sentCount)
        val progress = ReplyDeliveryPolicy.progress(sentCount, parts.size)
        synchronized(context) {
            context.pendingReplyParts.clear()
            context.pendingReplyParts.addAll(remaining)
            if (remaining.isEmpty()) {
                context.pendingReplyIncomingFingerprint = ""
            }
        }
        if (progress.isComplete) {
            replyConfirmed = confirmPendingReply(context)
            RuntimeJournal.messageSent(true, "回复发送完成 ${progress.sentParts}/${progress.totalParts}")
        } else {
            android.util.Log.w(
                "AIA",
                "reply delivery incomplete sent=${progress.sentParts}/${progress.totalParts} remaining=${remaining.size}"
            )
        }
        android.util.Log.d(
            "AIA",
            "chat_timing stage=send elapsed=${System.currentTimeMillis() - deliveryStartedAt} sent=${progress.sentParts}/${progress.totalParts}"
        )
        return ReplyDeliveryResult(
            status = if (progress.isComplete) ReplyDeliveryStatus.COMPLETE else ReplyDeliveryStatus.FAILED,
            sentParts = progress.sentParts,
            totalParts = progress.totalParts,
            confirmed = replyConfirmed
        )
    }

    private suspend fun verifyCurrentChatWithRetry(
        adapter: PlatformAdapter,
        expectedContactName: String,
        retries: Int = 3,
        retryDelayMs: Long = 400L
    ): Boolean {
        repeat(retries) { attempt ->
            if (verifyCurrentChat(adapter, expectedContactName)) return true
            if (attempt < retries - 1) delay(retryDelayMs)
        }
        return false
    }

    private suspend fun reopenConversationForDelivery(
        adapter: PlatformAdapter,
        context: ConversationContext,
        leaseToken: String
    ): Boolean {
        if (!canContinue(leaseToken, null)) return false
        if (GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS)) return false
        val svc = service ?: return false
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: return false
        val conversation = adapter.clickConversationByName(listRoot, context.contactName, true) ?: return false
        RuntimeJournal.clickConversation(conversation.contactName, true)
        val recovered = waitForVerifiedChat(svc, adapter, conversation.contactName, leaseToken) ?: return false
        if (recovered.packageName?.toString() != adapter.packageName) return false
        android.util.Log.d("AIA", "reply delivery reopened verified chat contact=${context.contactName}")
        return true
    }

    private fun verifyCurrentChat(adapter: PlatformAdapter, expectedContactName: String): Boolean {
        val root = service?.rootInActiveWindow ?: return false
        if (root.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) return false
        return ConversationIdentity.matches(expectedContactName, adapter.readChatTitle(root))
    }

    private fun incomingStillCurrent(
        adapter: PlatformAdapter,
        context: ConversationContext,
        expectedFingerprint: String
    ): Boolean {
        if (expectedFingerprint.isBlank()) return false
        val root = service?.rootInActiveWindow ?: return false
        if (root.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) return false
        if (!ConversationIdentity.matches(context.contactName, adapter.readChatTitle(root))) return false
        val current = IncomingMessageBatch.incomingHistoryFingerprint(adapter.readMessages(root))
        return !ReplyDeliveryPolicy.incomingChanged(expectedFingerprint, current)
    }

    private suspend fun confirmPendingReply(context: ConversationContext): Boolean {
        val replyId = synchronized(context) { context.pendingReplyId }
        if (replyId.isBlank()) return true
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isBlank()) return false
        val apiBaseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
        val confirmed = runCatching {
            ApiService(apiBaseUrl).confirmChatReply(token, replyId, "")
        }.getOrDefault(false)
        if (confirmed) {
            synchronized(context) {
                if (context.pendingReplyId == replyId) context.pendingReplyId = ""
            }
        }
        android.util.Log.d("AIA", "chat confirm replyId=$replyId success=$confirmed")
        return confirmed
    }

    private fun clearPendingReply(context: ConversationContext) {
        synchronized(context) {
            context.pendingReplyParts.clear()
            context.pendingReplyId = ""
            context.pendingReplyIncomingFingerprint = ""
            context.pendingReplyBatchFingerprint = ""
        }
    }

    private fun conversationKey(contactId: String): String = "$currentPlatform:$contactId"

    private fun markHandled(contactId: String) {
        if (contactId.isBlank()) return
        handledConversationIds.add(conversationKey(contactId))
    }

    private fun isHandled(contactId: String): Boolean {
        return contactId.isNotBlank() && conversationKey(contactId) in handledConversationIds
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
                    context.pendingReplyParts.clear()
                    context.pendingReplyId = ""
                    context.pendingReplyIncomingFingerprint = ""
                    context.pendingReplyBatchFingerprint = ""
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
            val messages = adapter.readMessages(root)
            val fingerprint = IncomingMessageBatch.incomingHistoryFingerprint(messages)
            synchronized(context) {
                if (fingerprint != context.lastIncomingFingerprint) {
                    context.lastIncomingFingerprint = fingerprint
                    context.llmRequestId++
                    context.pendingReplyParts.clear()
                    context.pendingReplyId = ""
                    context.pendingReplyIncomingFingerprint = ""
                    context.pendingReplyBatchFingerprint = ""
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
            activeContext?.let(::clearPendingReply)
            clearInputField()
        }
        handledConversationIds.clear()
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
        if (!HostingCompletionPolicy.canPerformScreenActions(hostingMode)) return
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
        val messages: List<PlatformAdapter.ChatMessage>,
        val retryInPlace: Boolean = false,
        val reason: String = ""
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
