package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.ChatPageStabilityPolicy
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulAdapter
import com.aaiagent.adapter.SoulInteractionMessage
import com.aaiagent.adapter.SoulMediaType
import com.aaiagent.adapter.SoulMomentCard
import com.aaiagent.adapter.SoulVoiceContent
import com.aaiagent.adapter.SoulVoiceDelivery
import com.aaiagent.adapter.SoulVoiceRecordPolicy
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.network.ApiService
import com.aaiagent.xposed.InjectPcmStore
import com.aaiagent.network.ChatRequest
import com.aaiagent.network.ChatResponse
import com.aaiagent.network.ChatMedia
import com.aaiagent.network.ExchangeMediaRequest
import com.aaiagent.network.ReplyTask
import com.aaiagent.engine.observability.AutomationTrace
import com.aaiagent.engine.observability.AutomationPageKind
import com.aaiagent.engine.observability.SoulShadowProbePolicy
import com.aaiagent.engine.automation.AutomationActionGate
import com.aaiagent.engine.automation.AutomationRecoveryPolicy
import com.aaiagent.engine.sampling.PageSampleResult
import com.aaiagent.engine.sampling.PageSampler
import com.aaiagent.engine.work.ConversationOrchestrator
import com.aaiagent.engine.work.ConversationEntryCoordinator
import com.aaiagent.engine.work.ConversationEntryOutcome
import com.aaiagent.engine.work.ConversationReplyPlan
import com.aaiagent.engine.work.ConversationReplyPlanner
import com.aaiagent.engine.work.ConversationShadowObserver
import com.aaiagent.engine.work.SoulConversationUiContract
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

private data class ReplySuggestion(
    val content: String,
    val replyId: String?,
    val media: ChatMedia? = null,
    val deliveryFingerprint: String? = null,
    val incomingBatchFingerprint: String? = null,
    val selfLeaveCooldownMs: Long? = null,
    /**
     * 后端这次要的是**媒体**（`action=send_media`）吗。
     *
     * 单独记一笔是因为：媒体有可能"要了但没选出来"（media 为 null），
     * 这时回复会掉进文字分支 —— 而语音岔路口必须知道"这本来是条媒体回复"，
     * 否则它会把"那就只发一张"这种话发成语音，照片永远发不出去。
     */
    val mediaExpected: Boolean = false
)

class MessageEngine(
    private val service: AccessibilityService?,
    private val repository: AppRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val adapterRegistry: AdapterRegistry? = service?.let { AdapterRegistry(it) }
    private val lease = AutomationLease()
    private val conversationTaskGate = ConversationTaskGate()
    private val wakeSignal = Channel<Unit>(Channel.CONFLATED)
    private val contextStore = ConversationContextStore()
    private val handledConversations = HandledConversationRegistry(
        currentPlatform = { currentPlatform },
    )
    private val staleRetryQueue = StaleConversationRetryQueue()
    private var hostingJob: Job? = null
    private val contactSyncScheduler = ContactSyncScheduler(
        scope = scope,
        currentPlatform = { currentPlatform },
        registerContact = { api, token, platform, contactId, contactName ->
            api.registerContact(token, platform, contactId, contactName)
        },
    )
    private val conversationRecovery = ConversationRecoveryPersistence(repository)
    private val replyConfirmationQueue = ReplyConfirmationQueue(repository, scope)
    private val messageSyncOutbox = MessageSyncOutboxQueue(repository, scope)
    private val replyTaskReporter = ReplyTaskReporter(repository, scope)
    private val backendReplyTaskPoller = BackendReplyTaskPoller(
        repository = repository,
        scope = scope,
        currentPlatform = { currentPlatform },
        canAcceptTask = { leaseToken -> hostingEnabled && lease.owns(leaseToken) },
    )
    /** 2026-10-06：最近发出去的话（用于拦住“把 A 的话发给 B”这种串台）。 */
    private val recentOutgoingSends = RecentOutgoingSendMemory()
    private var nextConversationScanAtMs: Long = 0L
    private var lastContentChangeWakeAtMs: Long = 0L
    private var contentChangeJob: Job? = null
    private var profileRecoveryJob: Job? = null
    @Volatile
    private var lastProfileRecoveryAtMs = 0L
    private var lastSoulShadowProbeAtMs = 0L
    private var soulShadowObserver: ConversationShadowObserver? = null
    private var soulEntryCoordinator: ConversationEntryCoordinator? = null
    private var lastVisionPageRecoveryAtMs = 0L
    private val manualChatSyncJobs = mutableMapOf<String, Job>()
    private var observedState: EngineState = EngineState.Idle
    private var observedStateSinceMs: Long = System.currentTimeMillis()
    private val contactCooldown = ContactCooldownGuard(
        repository = repository,
        currentPlatform = { currentPlatform },
    )
    private val contactAccess = ContactAccessGuard(repository, contactCooldown)
    private val contentChangeStability = ContentChangeStabilityPolicy()
    private val chatPageIdentityTracker = ChatPageIdentityTracker()
    private val replyDeliveryVerifier = ReplyDeliveryVerifier(
        rootProvider = { service?.rootInActiveWindow },
        isIdentityConfirmed = { adapter, root, expectedContactName ->
            isChatIdentityConfirmed(adapter, root, expectedContactName)
        },
    )

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

    @Volatile
    private var automationOwnedChatKey: String? = null

    init {
        service?.let {
            val versionName = runCatching {
                it.packageManager.getPackageInfo(it.packageName, 0).versionName.orEmpty()
            }.getOrDefault("")
            RuntimeJournal.init(java.io.File(it.filesDir, "journal"), versionName)
        }
    }

    fun startHosting(platform: String) {
        val previousPlatform = currentPlatform
        currentPlatform = platform
        automationOwnedChatKey = null
        hostingEnabled = true
        GestureMonitor.onAutomationActionStarted(protectionMs = 1_500L)
        android.util.Log.d("AIA", "HostingStarted platform=$platform mode=$hostingMode")
        RuntimeJournal.stateChange(state.toString(), "HostingStarted")

        if (hostingJob?.isActive == true && lease.owns(activeLeaseToken) && previousPlatform == platform) {
            lease.renew(activeLeaseToken)
            wakeSignal.trySend(Unit)
            return
        }

        observedState = EngineState.Idle
        observedStateSinceMs = System.currentTimeMillis()
        state = EngineState.Idle
        backendReplyTaskPoller.clear()
        hostingJob?.cancel()
        activeLeaseToken = lease.acquire()
        val leaseToken = activeLeaseToken
        hostingJob = scope.launch {
            restoreInFlightConversations()
            replyConfirmationQueue.scheduleFlush(force = true)
            messageSyncOutbox.schedule(force = true)
            runHostingLoop(leaseToken)
        }
    }

    fun stopHosting() {
        hostingEnabled = false
        android.util.Log.d("AIA", "hosting loop stopped because hosting was stopped")
        lease.revoke()
        hostingJob?.cancel()
        hostingJob = null
        backendReplyTaskPoller.clear()
        activeContext = null
        automationOwnedChatKey = null
        handledConversations.clear()
        staleRetryQueue.clear()
        contextStore.all().forEach(::clearPendingReply)
        clearInputField()
        state = EngineState.Idle
    }

    suspend fun clearRecoveryState() {
        conversationRecovery.clear()
    }

    private suspend fun restoreInFlightConversations() {
        val now = System.currentTimeMillis()
        val recoverable = conversationRecovery.recoverable(currentPlatform, now)
        if (recoverable.isEmpty()) return

        for (record in recoverable) {
            val context = contextStore.getOrCreate(record.platform, record.contactId)
            synchronized(context) {
                context.contactName = record.contactName
                context.pendingReplyParts.clear()
                context.pendingReplyParts.addAll(record.pendingReplyParts)
                context.pendingReplyId = record.pendingReplyId
                context.pendingReplyIncomingFingerprint = record.pendingReplyIncomingFingerprint
                context.pendingReplyBatchFingerprint = record.pendingReplyBatchFingerprint
                context.pendingReplyFullContent = record.pendingReplyFullContent
                context.pendingReplySentParts = record.sentParts
                context.pendingReplyTotalParts = record.totalParts
                context.pendingReplyStale = false
            }
            staleRetryQueue.restore(
                platform = currentPlatform,
                contactId = record.contactId,
                contactName = record.contactName,
                dueAtMs = now,
            )
        }
        android.util.Log.d(
            "AIA",
            "restored in-flight conversations count=${recoverable.size} platform=$currentPlatform"
        )
        wakeSignal.trySend(Unit)
    }

    private suspend fun saveConversationRecovery(context: ConversationContext) {
        conversationRecovery.save(context)
    }

    private suspend fun removeConversationRecovery(context: ConversationContext) {
        removeConversationRecovery(context.platform, context.contactId)
    }

    private suspend fun removeConversationRecovery(platform: String, contactId: String) {
        conversationRecovery.remove(platform, contactId)
    }

    private suspend fun reconcileConversationRecovery(context: ConversationContext) {
        conversationRecovery.reconcile(context)
    }

    private suspend fun runHostingLoop(leaseToken: String) {
        delay(400)
        while (hostingEnabled && lease.owns(leaseToken) && scope.isActive) {
            lease.renew(leaseToken)
            replyConfirmationQueue.scheduleFlush()
            messageSyncOutbox.schedule()
            val nowMs = System.currentTimeMillis()
            if (GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS)) {
                state = EngineState.Paused
                delay(500)
                continue
            }

            if (state == EngineState.Paused) {
                state = EngineState.Idle
            }
            recoverStaleStateIfNeeded(nowMs)
            if (state == EngineState.Idle) {
                observeSoulShadowIfDue()
                var processedConversation = false
                try {
                    processedConversation = withLeaseHeartbeat(leaseToken) {
                        scanAndProcess(leaseToken)
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    android.util.Log.e("AIA", "hosting loop crashed", error)
                    RuntimeJournal.recovery("托管循环异常: ${error.message}")
                    state = EngineState.Error
                } finally {
                    // 这个集合只用于防止同一次扫描里重复处理。处理成功时下面会
                    // continue，若只清在循环尾部，联系人会被永久记成“已处理”，
                    // 运行数小时后所有老联系人都会漏掉。
                    handledConversations.clear()
                }

                if (processedConversation) continue
            }

            val wokeEarly = withTimeoutOrNull(POLL_INTERVAL_MS) {
                wakeSignal.receive()
            } != null
            val nextScanInMs = (nextConversationScanAtMs - System.currentTimeMillis()).coerceAtLeast(0L)
            android.util.Log.d(
                "AIA",
                "message-list round complete wokeEarly=$wokeEarly state=$state next_scan_in_ms=$nextScanInMs"
            )
        }

        if (hostingEnabled && !lease.owns(leaseToken)) {
            android.util.Log.w(
                "AIA",
                "hosting loop stopped because lease state=${lease.status(leaseToken)}"
            )
        }
    }

    /**
     * A state left behind after an interrupted coroutine is allowed to settle
     * for a bounded period. Only then does the loop recover it, so a normal
     * in-flight operation is not overwritten merely because one loop tick
     * started while it was busy.
     */
    private fun recoverStaleStateIfNeeded(nowMs: Long) {
        if (state !== observedState) {
            observedState = state
            observedStateSinceMs = nowMs
            return
        }
        if (!EngineStateRecoveryPolicy.shouldRecover(
                state = state,
                enteredAtMs = observedStateSinceMs,
                nowMs = nowMs,
            )
        ) return

        val elapsed = (nowMs - observedStateSinceMs).coerceAtLeast(0L)
        android.util.Log.w(
            "AIA",
            "recovering stale engine state=$state elapsed_ms=$elapsed"
        )
        RuntimeJournal.recovery("状态卡死自动恢复 state=$state elapsed_ms=$elapsed")
        state = EngineState.Idle
        observedState = EngineState.Idle
        observedStateSinceMs = nowMs
    }

    private suspend fun <T> withLeaseHeartbeat(
        leaseToken: String,
        block: suspend () -> T
    ): T = withAutomationLeaseHeartbeat(
        lease = lease,
        leaseToken = leaseToken,
        isEnabled = { hostingEnabled },
        intervalMs = LEASE_HEARTBEAT_INTERVAL_MS,
        block = block,
    )

    private suspend fun scanAndProcess(leaseToken: String): Boolean {
        if (!conversationTaskGate.tryBegin()) {
            RuntimeJournal.recovery("已有会话任务占用聊天页，跳过本轮扫描")
            return false
        }
        try {
            val refreshPauseMs = AutomationTrace.refreshStormPauseRemainingMs()
            if (refreshPauseMs > 0L) {
                nextConversationScanAtMs = System.currentTimeMillis() + refreshPauseMs
                RuntimeJournal.recovery("检测到列表刷新风暴，暂停扫描 ${refreshPauseMs}ms")
                captureIncidentScreenshot("refresh_storm")
                return false
            }
            val owner = "scan:${currentPlatform.ifBlank { "unknown" }}:${leaseToken.takeLast(8)}"
            val result = AutomationActionGate.withPermit(owner) {
                scanAndProcessLocked(leaseToken)
            }
            if (result != null) return result
            RuntimeJournal.recovery(
                "页面正被其他自动化动作占用，跳过本轮扫描 owner=$owner " +
                    "current=${AutomationActionGate.currentOwner()}"
            )
            return false
        } finally {
            conversationTaskGate.finish()
        }
    }

    /**
     * 新流程影子通道：只读当前屏幕并记录判断，绝不点击、滚动或发送。
     */
    private suspend fun observeSoulShadowIfDue() {
        val nowMs = System.currentTimeMillis()
        if (!SoulShadowProbePolicy.shouldProbe(
                hostingEnabled = hostingEnabled,
                platform = currentPlatform,
                elapsedMs = nowMs - lastSoulShadowProbeAtMs,
                intervalMs = SOUL_SHADOW_PROBE_INTERVAL_MS,
            )
        ) return
        lastSoulShadowProbeAtMs = nowMs

        probeSoulShadowNow()
    }

    /**
     * 只读探测一次 Soul 当前页面，供真机验证和页面采样使用。
     */
    suspend fun probeSoulShadowNow(): Boolean {
        val svc = service ?: return false
        val adapter = adapterRegistry?.getByPlatform("soul") as? SoulAdapter ?: return false
        val root = svc.rootInActiveWindow ?: return false
        if (root.packageName?.toString() != adapter.packageName) return false

        try {
            val observer = soulShadowObserver ?: run {
                val orchestrator = ConversationOrchestrator(
                    ui = SoulConversationUiContract(svc, adapter),
                    planner = ConversationReplyPlanner { _, _ ->
                        ConversationReplyPlan(emptyList(), "影子模式不生成回复")
                    },
                    shadowMode = true,
                )
                ConversationShadowObserver(
                    probe = { orchestrator.processNext() },
                    report = { step, detail -> RuntimeJournal.log(step, detail) },
                ).also { soulShadowObserver = it }
            }
            observer.observeOnce()
            return true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            android.util.Log.w("AIA", "soul shadow probe failed", error)
            return false
        }
    }

    private suspend fun scanAndProcessLocked(leaseToken: String): Boolean {
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

        if (processDueStaleRetry(svc, adapter, leaseToken)) {
            state = EngineState.Idle
            return true
        }

        if (hostingMode != HostingMode.MONITOR_ONLY) {
            val task = backendReplyTaskPoller.nextTask()
            if (task != null && processBackendReplyTask(svc, adapter, task, leaseToken)) {
                state = EngineState.Idle
                return true
            }
            backendReplyTaskPoller.schedule(leaseToken)
        }

        val activeRoot = svc.rootInActiveWindow
        if (activeRoot?.packageName?.toString() == adapter.packageName && adapter.isInChat(activeRoot)) {
            val preparedChat = adapter.prepareChatForAutomation(activeRoot)
            if (!preparedChat.ready) {
                val blockedName = adapter.readChatTitle(preparedChat.root)
                contactCooldown.block(blockedName, preparedChat.retryAfterMs)
                RuntimeJournal.recovery("启动时聊天页被平台锁定，退回消息列表")
                returnToMessageList(adapter, leaseToken, "chat locked on start")
                state = EngineState.Idle
                return false
            }
            val title = adapter.readChatTitle(preparedChat.root)
            if (!title.isNullOrBlank()) {
                if (contactCooldown.isCoolingDown(title, title)) {
                    state = EngineState.Idle
                    return false
                }
                if (contactAccess.allows(title, title)) {
                    handledConversations.mark(title)
                    processVerifiedChat(adapter, preparedChat.root, title, title, leaseToken)
                } else {
                    handledConversations.mark(title)
                    returnToMessageList(adapter, leaseToken, "contact filtered")
                }
                return false
            }
        }
        if (activeRoot?.packageName?.toString() == adapter.packageName &&
            !adapter.isInChat(activeRoot) &&
            !adapter.isInMessageList(activeRoot)
        ) {
            when (adapter.observePage(activeRoot).kind) {
                AutomationPageKind.PROFILE_PAGE -> {
                    RuntimeJournal.recovery("扫描前发现资料页，主动退回消息列表")
                    returnToMessageList(adapter, leaseToken, "profile page on scan entry")
                    state = EngineState.Idle
                    return true
                }
                AutomationPageKind.UNKNOWN -> {
                    if (recoverUnknownPageWithVision(adapter, leaseToken)) {
                        state = EngineState.Idle
                        return true
                    }
                }
                else -> Unit
            }
        }

        state = EngineState.ScanningConversations
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            state = EngineState.Idle
            return false
        }
        if (!canContinue(leaseToken, null)) {
            state = EngineState.Idle
            return false
        }

        val visibleUnreadCount = adapter.visibleUnreadCount(listRoot)
        if (visibleUnreadCount > 0) nextConversationScanAtMs = 0L
        if (visibleUnreadCount == 0 &&
            System.currentTimeMillis() < nextConversationScanAtMs
        ) {
            state = EngineState.Idle
            return false
        }

        if (NEW_SOUL_ENTRY_TAKEOVER_ENABLED && adapter is SoulAdapter) {
            val handled = tryOpenSoulConversationWithNewCore(
                svc = svc,
                adapter = adapter,
                leaseToken = leaseToken,
            )
            if (!handled) {
                val liveRoot = svc.rootInActiveWindow
                if (liveRoot != null && adapter.hasTabUnread(liveRoot)) {
                    val scrolled = adapter.scrollMessageListDown(liveRoot)
                    if (scrolled) {
                        delay(600)
                        val scrolledRoot = svc.rootInActiveWindow
                        if (scrolledRoot != null && adapter.visibleUnreadCount(scrolledRoot) > 0) {
                            nextConversationScanAtMs = 0L
                            state = EngineState.Idle
                            return true
                        }
                    }
                } else if (liveRoot != null && !adapter.hasTabUnread(liveRoot)) {
                    adapter.scrollMessageListToTop(liveRoot)
                }
                nextConversationScanAtMs = System.currentTimeMillis() + SOUL_LIST_IDLE_RESCAN_MS
            }
            state = EngineState.Idle
            return handled
        }

        val fallbackRoot = liveMessageListRoot(svc, adapter, listRoot)
        val info = adapter.clickFirstUnreadConversation(
            fallbackRoot,
            shouldClick = true,
            contactFilter = { contactName, contactId ->
                !handledConversations.contains(contactId) &&
                    !contactCooldown.isCoolingDown(contactName, contactId) &&
                    contactAccess.allows(contactName, contactId)
            }
        )
        if (info == null) {
            state = EngineState.Idle
            return false
        }
        RuntimeJournal.clickConversation(info.contactName, true)

        val verifiedChat = waitForVerifiedChat(svc, adapter, info.contactName, leaseToken)
        if (verifiedChat == null) {
            handledConversations.mark(info.contactId)
            state = EngineState.Idle
            return true
        }

        processVerifiedChat(
            adapter = adapter,
            chatRoot = verifiedChat,
            contactId = info.contactId,
            contactName = info.contactName,
            leaseToken = leaseToken,
            latestListPreview = info.preview,
            relationshipOrigin = info.relationshipOrigin,
        )
        handledConversations.mark(info.contactId)
        return true
    }

    /**
     * 新核心先接管 Soul 的真实入口：保存未读任务 → 点击 → 精确确认联系人。
     * 确认无误后立即交给现有回复流程，媒体、语音、后台规则继续走原路。
     */
    private suspend fun tryOpenSoulConversationWithNewCore(
        svc: AccessibilityService,
        adapter: SoulAdapter,
        leaseToken: String,
    ): Boolean {
        if (GestureMonitor.isUserTouchingRecently(USER_NAVIGATION_GRACE_MS)) return false
        val coordinator = soulEntryCoordinator ?: ConversationEntryCoordinator(
            ui = SoulConversationUiContract(svc, adapter)
        ).also { soulEntryCoordinator = it }

        val outcome = coordinator.openVisibleNext(
            maxEntries = SOUL_ENTRY_MAX_ENTRIES,
            candidateFilter = { identity ->
                val contactId = identity.displayName
                !handledConversations.contains(contactId) &&
                    !contactCooldown.isCoolingDown(contactId, contactId) &&
                    contactAccess.allows(contactId, contactId)
            },
        )
        return when (outcome) {
            is ConversationEntryOutcome.Opened -> {
                val identity = outcome.identity
                val contactId = identity.displayName
                val root = svc.rootInActiveWindow
                if (root?.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) {
                    coordinator.markRetry(identity.key, "确认后聊天页已离开")
                    true
                } else {
                    val prepared = adapter.prepareChatForAutomation(root)
                    if (!prepared.ready) {
                        contactCooldown.block(
                            contactId,
                            prepared.retryAfterMs.coerceAtLeast(1_000L),
                        )
                        coordinator.markRetry(identity.key, "聊天页被平台锁定")
                        returnToMessageList(adapter, leaseToken, "soul entry blocked")
                        true
                    } else {
                        handledConversations.mark(contactId)
                        RuntimeJournal.clickConversation(contactId, true)
                        val origin = runCatching {
                            RelationshipOrigin.valueOf(identity.origin.uppercase())
                        }.getOrDefault(RelationshipOrigin.UNKNOWN)
                        processVerifiedChat(
                            adapter = adapter,
                            chatRoot = prepared.root,
                            contactId = contactId,
                            contactName = contactId,
                            leaseToken = leaseToken,
                            latestListPreview = identity.preview,
                            relationshipOrigin = origin,
                        )
                        coordinator.markComplete(identity.key)
                        nextConversationScanAtMs = 0L
                        true
                    }
                }
            }
            is ConversationEntryOutcome.RetryLater -> {
                RuntimeJournal.recovery(
                    "新核心入口稍后重试 contact=${outcome.identity.displayName} reason=${outcome.reason}"
                )
                true
            }
            is ConversationEntryOutcome.Blocked -> {
                RuntimeJournal.recovery(
                    "新核心入口已拦下 contact=${outcome.identity.displayName} reason=${outcome.reason}"
                )
                true
            }
            is ConversationEntryOutcome.RiskOverlay -> {
                RuntimeJournal.recovery(
                    "新核心入口识别风险弹窗 reason=${outcome.reason} acted=${outcome.acted}"
                )
                true
            }
            ConversationEntryOutcome.NoWork,
            is ConversationEntryOutcome.PageNotReady,
            -> false
        }
    }

    /** Re-read the live list before clicking anything. */
    private fun liveMessageListRoot(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        fallback: AccessibilityNodeInfo
    ): AccessibilityNodeInfo {
        val current = svc.rootInActiveWindow ?: return fallback
        if (current.packageName?.toString() != adapter.packageName) return fallback
        return if (adapter.isInMessageList(current)) current else fallback
    }

    /**
     * Monitor-only mode is strictly read-only. It never opens, clicks, scrolls,
     * fills, clears, sends, or navigates away from the page the user is viewing.
     */
    private suspend fun processDueStaleRetry(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        leaseToken: String
    ): Boolean {
        val now = System.currentTimeMillis()
        val retry = staleRetryQueue.takeDue(currentPlatform, now) ?: return false

        if (retry.attempts > MAX_STALE_RETRIES) {
            removeConversationRecovery(retry.platform, retry.contactId)
            staleRetryQueue.remove(retry)
            return true
        }
        if (!canContinue(leaseToken, null)) {
            staleRetryQueue.reschedule(retry, delayMs = STALE_RETRY_DELAY_MS)
            return true
        }
        if (!contactAccess.allows(retry.contactName, retry.contactId)) {
            removeConversationRecovery(retry.platform, retry.contactId)
            staleRetryQueue.clearInFlight(retry)
            return true
        }

        android.util.Log.d(
            "AIA",
            "stale reply retry attempt=${retry.attempts} contact=${retry.contactName}"
        )
        try {
            val currentRoot = svc.rootInActiveWindow
            val verifiedChat = if (
                currentRoot?.packageName?.toString() == adapter.packageName &&
                adapter.isInChat(currentRoot) &&
                ConversationIdentity.matches(retry.contactName, adapter.readChatTitle(currentRoot))
            ) {
                currentRoot
            } else {
                val listRoot = ensureMessageList(svc, adapter, leaseToken)
                val conversation = listRoot?.let {
                    adapter.clickConversationByName(it, retry.contactName, true)
                }
                conversation?.let {
                    RuntimeJournal.clickConversation(it.contactName, true)
                    waitForVerifiedChat(svc, adapter, it.contactName, leaseToken)
                }
            }
            if (verifiedChat == null) {
                staleRetryQueue.scheduleNext(
                    retry = retry,
                    delayMs = STALE_RETRY_DELAY_MS,
                    maxAttempts = MAX_STALE_RETRIES,
                )
                return true
            }

            processVerifiedChat(
                adapter = adapter,
                chatRoot = verifiedChat,
                contactId = retry.contactId,
                contactName = retry.contactName,
                leaseToken = leaseToken,
                latestListPreview = "",
            )
            val context = contextStore.getOrCreate(currentPlatform, retry.contactId)
            val stillPending = synchronized(context) {
                context.pendingReplyParts.isNotEmpty() || context.pendingReplyId.isNotBlank()
            }
            if (stillPending) {
                staleRetryQueue.scheduleNext(
                    retry = retry,
                    delayMs = STALE_RETRY_DELAY_MS,
                    maxAttempts = MAX_STALE_RETRIES,
                )
            }
        } finally {
            staleRetryQueue.clearInFlight(retry)
        }
        return true
    }

    private suspend fun recordCurrentChatOnly(
        adapter: PlatformAdapter,
        chatRoot: AccessibilityNodeInfo,
        leaseToken: String
    ) {
        if (hostingMode != HostingMode.MONITOR_ONLY || !canContinue(leaseToken, null)) return
        val contactName = adapter.readChatTitle(chatRoot)?.trim().orEmpty()
        if (contactName.isBlank() || !contactAccess.allows(contactName, contactName)) return

        val context = contextStore.getOrCreate(currentPlatform, contactName).also {
            it.contactName = contactName
            activeContext = it
        }
        state = EngineState.ReadingMessages
        try {
            var messages = readMessagesWithRetry(adapter, contactName, leaseToken)
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
        task: ReplyTask,
        leaseToken: String
    ): Boolean {
        return when (ReplyTaskPolicy.decide(task.type, task.platform, currentPlatform)) {
            ReplyTaskAction.SEND_EXACT -> processManualReplyTask(svc, adapter, task, leaseToken)
            ReplyTaskAction.PROCESS_AI -> processPriorityContactTask(svc, adapter, task, leaseToken)
            ReplyTaskAction.IGNORE -> false
        }
    }

    private suspend fun processManualReplyTask(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        task: ReplyTask,
        leaseToken: String
    ): Boolean {
        val content = task.content?.trim().orEmpty()
        if (content.isEmpty()) {
            replyTaskReporter.report(task.taskId, "failed", "empty_content")
            return true
        }
        if (!contactAccess.allows(task.contactName, task.contactId)) {
            replyTaskReporter.report(task.taskId, "failed", "contact_filtered")
            return true
        }
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: run {
            replyTaskReporter.report(task.taskId, "failed", "message_list_unavailable")
            return true
        }
        val conversation = adapter.clickConversationByName(listRoot, task.contactName, true) ?: run {
            replyTaskReporter.report(task.taskId, "failed", "contact_not_found")
            return true
        }
        RuntimeJournal.clickConversation(conversation.contactName, true)
        val chatRoot = waitForVerifiedChat(svc, adapter, conversation.contactName, leaseToken) ?: run {
            replyTaskReporter.report(task.taskId, "failed", "chat_verification_failed")
            return true
        }
        if (!contactAccess.allows(conversation.contactName, conversation.contactId)) {
            replyTaskReporter.report(task.taskId, "failed", "contact_filtered")
            returnToMessageList(adapter, leaseToken, "manual task contact filtered")
            return true
        }
        if (!canContinue(leaseToken, null)) return true

        state = EngineState.Sending
        val result = adapter.fillAndSend(
            service = svc,
            root = chatRoot,
            text = content,
            expectedContactName = conversation.contactName,
            canProceed = { canContinue(leaseToken, null) }
        )
        val status = if (result == PlatformAdapter.SendResult.SUCCESS) "sent" else "failed"
        val error = if (status == "sent") "" else "send_result_$result"
        replyTaskReporter.report(task.taskId, status, error)
        RuntimeJournal.messageSent(status == "sent", "后台人工消息 ${conversation.contactName}")
        if (status == "sent") {
            synchronized(contextStore.getOrCreate(currentPlatform, conversation.contactId)) {
                contextStore.getOrCreate(currentPlatform, conversation.contactId).rememberAutomatedReply(content)
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
        if (!contactAccess.allows(task.contactName, task.contactId)) return true
        if (contactCooldown.isCoolingDown(task.contactName, task.contactId)) return true
        val listRoot = ensureMessageList(svc, adapter, leaseToken) ?: return true
        val conversation = adapter.clickConversationByName(listRoot, task.contactName, true) ?: return false
        RuntimeJournal.clickConversation(conversation.contactName, true)
        val chatRoot = waitForVerifiedChat(svc, adapter, conversation.contactName, leaseToken) ?: return true
        processVerifiedChat(
            adapter = adapter,
            chatRoot = chatRoot,
            contactId = conversation.contactId,
            contactName = conversation.contactName,
            leaseToken = leaseToken,
            latestListPreview = conversation.preview
        )
        return true
    }

    private suspend fun processVerifiedChat(
        adapter: PlatformAdapter,
        chatRoot: AccessibilityNodeInfo,
        contactId: String,
        contactName: String,
        leaseToken: String,
        latestListPreview: String = "",
        relationshipOrigin: RelationshipOrigin = RelationshipOrigin.UNKNOWN,
    ) {
        automationOwnedChatKey = conversationKey(contactId)
        chatPageIdentityTracker.reset()
        if (!contactAccess.allows(contactName, contactId)) {
            removeConversationRecovery(currentPlatform, contactId)
            RuntimeJournal.recovery("联系人策略跳过 contact=$contactName")
            returnToMessageList(adapter, leaseToken, "contact filtered")
            return
        }
        val context = contextStore.getOrCreate(currentPlatform, contactId).also {
            it.contactName = contactName
            it.relationshipOrigin = relationshipOrigin
            val detectedStage = adapter.detectConversationStage(chatRoot)
            if (detectedStage != ConversationStage.UNKNOWN) {
                it.conversationStage = detectedStage
            } else if (relationshipOrigin == RelationshipOrigin.SOULMATE) {
                it.conversationStage = ConversationStage.SOULMATE
            }
            synchronized(it) {
                it.llmRequestId++
                it.firstMessageAt = System.currentTimeMillis()
                it.recalcCount = 0
            }
            activeContext = it
        }
        android.util.Log.d(
            "AIA",
            "conversation_stage contact=${context.contactName} id=${context.contactId} " +
                "origin=${context.relationshipOrigin.name.lowercase()} " +
                "stage=${context.conversationStage.name.lowercase()}"
        )

        if (hostingMode != HostingMode.MONITOR_ONLY) saveConversationRecovery(context)
        var completed = false
        try {
            processConversation(
                adapter = adapter,
                context = context,
                chatRoot = chatRoot,
                leaseToken = leaseToken,
                latestListPreview = latestListPreview,
            )
            completed = true
        } finally {
            activeContext = null
            if (completed && hostingMode != HostingMode.MONITOR_ONLY) {
                try {
                    reconcileConversationRecovery(context)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    android.util.Log.w("AIA", "conversation recovery reconciliation failed", error)
                }
            }
        }
    }

    private suspend fun prepareChatBeforeAction(
        adapter: PlatformAdapter,
        context: ConversationContext,
        leaseToken: String,
    ): Boolean {
        var root = service?.rootInActiveWindow
        // The accessibility tree can be mid-update while a platform panel
        // animates in. Re-read the active window once before giving up on an
        // already generated reply.
        if (root == null ||
            root.packageName?.toString() != adapter.packageName ||
            !isChatIdentityConfirmed(adapter, root, context.contactName)
        ) {
            delay(CHAT_PAGE_RECHECK_DELAY_MS)
            root = service?.rootInActiveWindow
        }
        root ?: return refuseSendSilently(context, "发送前拿不到当前页面")
        if (root.packageName?.toString() != adapter.packageName) {
            return refuseSendSilently(context, "发送前目标应用不在前台")
        }
        // 2026-10-05 真机（每天都是好心情ccc/敬岁月）：新联系人页面的关系卡片动画结束时页面会重绘，
        // isInChat 有一瞬间为 false，于是刚生成好的回复被“发送前验证失败”丢掉，导航还会跑去点左上角进资料页。
        // 这里多等两次再判定，避免把正常回复扔掉。
        var currentRoot: AccessibilityNodeInfo = root
        var verified = isChatIdentityConfirmed(adapter, currentRoot, context.contactName)
        repeat(SEND_PRECHECK_ATTEMPTS) {
            if (verified) return@repeat
            delay(SEND_PRECHECK_DELAY_MS)
            val retryRoot = service?.rootInActiveWindow ?: return@repeat
            if (retryRoot.packageName?.toString() != adapter.packageName) return@repeat
            currentRoot = retryRoot
            verified = isChatIdentityConfirmed(adapter, currentRoot, context.contactName)
        }
        if (!verified) {
            return refuseSendSilently(context, "发送前聊天身份未确认")
        }
        root = currentRoot
        val preparation = adapter.prepareChatForAutomation(root)
        if (preparation.ready) return true
        contactCooldown.block(context.contactName, preparation.retryAfterMs)
        RuntimeJournal.recovery("发送前发现聊天页被平台锁定，取消本轮发送 contact=${context.contactName}")
        queueStaleRetry(context, preparation.retryAfterMs.coerceAtLeast(STALE_RETRY_DELAY_MS))
        returnToMessageList(adapter, leaseToken, "chat locked before send")
        return false
    }

    /**
     * Entry readiness only. It does not grant permission to send.
     * Sending must pass [isChatIdentityConfirmed].
     */
    private fun isChatPageReadyForEntry(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        expectedContactName: String,
    ): Boolean {
        return ChatPageAcceptancePolicy.accept(
            inChat = adapter.isInChat(root),
            titleMatchesContact = ConversationIdentity.matches(
                expectedContactName,
                adapter.readChatTitle(root),
            ),
        )
    }

    private fun observeChatIdentity(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        expectedContactName: String,
        previewMatches: Boolean,
    ): ChatPageIdentityDecision {
        val actualTitle = adapter.readChatTitle(root)
        val decision = chatPageIdentityTracker.observe(
            windowId = root.windowId,
            inChat = adapter.isInChat(root),
            expectedContact = expectedContactName,
            actualTitle = actualTitle,
            previewMatches = previewMatches,
        )
        android.util.Log.d(
            "AIA",
            "chat identity decision=$decision expected=$expectedContactName " +
                "title=${actualTitle.orEmpty()} previewMatches=$previewMatches",
        )
        return decision
    }

    private fun isChatIdentityConfirmed(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        expectedContactName: String,
    ): Boolean {
        return observeChatIdentity(
            adapter = adapter,
            root = root,
            expectedContactName = expectedContactName,
            previewMatches = false,
        ) == ChatPageIdentityDecision.CONFIRMED
    }

    /**
     * A refused send used to return silently, so a generated reply could vanish
     * with no trace. Always leave a journal entry and a log line instead.
     */
    private fun refuseSendSilently(context: ConversationContext, reason: String): Boolean {
        android.util.Log.w("AIA", "reply send refused reason=$reason contact=${context.contactName}")
        RuntimeJournal.messageSent(false, reason)
        // The page was lost after the reply had been generated. The chat has no
        // unread badge left, so without a retry the scan would never look at
        // this contact again and the reply would silently disappear.
        queueStaleRetry(context)
        return false
    }

    private suspend fun ensureMessageList(
        svc: AccessibilityService,
        adapter: PlatformAdapter,
        leaseToken: String
    ): AccessibilityNodeInfo? {
        automationOwnedChatKey = null
        repeat(5) { attempt ->
            if (!canContinue(leaseToken, null)) return null
            var root = svc.rootInActiveWindow
            if (root?.packageName?.toString() != adapter.packageName) {
                if (GestureMonitor.isUserTouchingRecently(USER_NAVIGATION_GRACE_MS)) {
                    android.util.Log.d(
                        "AIA",
                        "not stealing foreground while user is interacting"
                    )
                    return null
                }
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
            delay(
                if (attempt == 0) {
                    CHAT_VERIFY_INITIAL_DELAY_MS
                } else {
                    CHAT_VERIFY_RETRY_DELAY_MS
                }
            )
            if (!canContinue(leaseToken, null)) return null
            val root = svc.rootInActiveWindow ?: return@repeat
            val targetPackageForeground = root.packageName?.toString() == adapter.packageName
            val inChat = targetPackageForeground &&
                isChatPageReadyForEntry(adapter, root, expectedContactName)
            val actualTitle = if (inChat) adapter.readChatTitle(root) else null
            val identityConfirmed = inChat &&
                observeChatIdentity(
                    adapter = adapter,
                    root = root,
                    expectedContactName = expectedContactName,
                    previewMatches = false,
                ) == ChatPageIdentityDecision.CONFIRMED
            when (ChatVerificationPolicy.decide(
                targetPackageForeground = targetPackageForeground,
                inChat = inChat,
                expectedContactName = expectedContactName,
                actualTitle = actualTitle,
                identityConfirmed = identityConfirmed,
            )) {
                ChatVerificationAction.VERIFIED -> {
                    android.util.Log.d("AIA", "chat identity verified expected=$expectedContactName actual=$actualTitle")
                    val preparation = adapter.prepareChatForAutomation(root)
                    if (!preparation.ready) {
                        val retryAfterMs = preparation.retryAfterMs.coerceAtLeast(1_000L)
                        contactCooldown.block(actualTitle ?: expectedContactName, retryAfterMs)
                        RuntimeJournal.recovery(
                            "聊天页被平台对话框锁定，已退回消息列表并冷却 contact=${actualTitle ?: expectedContactName}"
                        )
                        svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                        delay(600)
                        return null
                    }
                    return preparation.root
                }
                ChatVerificationAction.BACK_TO_LIST -> {
                    RuntimeJournal.recovery("进入错会话 expected=$expectedContactName actual=$actualTitle")
                    svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    delay(600)
                    return null
                }
                ChatVerificationAction.RETRY -> Unit
                ChatVerificationAction.ABORT -> {
                    android.util.Log.d(
                        "AIA",
                        "chat verification aborted because target left foreground expected=$expectedContactName"
                    )
                    return null
                }
            }
        }

        val root = svc.rootInActiveWindow
        val targetPackageForeground = root?.packageName?.toString() == adapter.packageName
        val inChat = targetPackageForeground && root != null && adapter.isInChat(root)
        val actualTitle = if (inChat && root != null) adapter.readChatTitle(root) else null
        if (ChatVerificationPolicy.canPressBack(targetPackageForeground, inChat) &&
            !ChatTitlePolicy.isTransient(actualTitle)
        ) {
            try {
                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            } catch (_: Exception) {
            }
        }
        val inMessageList = root != null && targetPackageForeground && adapter.isInMessageList(root)
        val foregroundPackage = root?.packageName?.toString().orEmpty()
        val rootClass = root?.className?.toString().orEmpty()
        android.util.Log.w(
            "AIA",
            "chat verification failed expected=$expectedContactName targetForeground=$targetPackageForeground " +
                "inChat=$inChat inMessageList=$inMessageList foregroundPackage=$foregroundPackage rootClass=$rootClass"
        )
        RuntimeJournal.recovery(
            "聊天页或联系人标题验证失败 expected=$expectedContactName targetForeground=$targetPackageForeground inChat=$inChat"
        )
        return null
    }

    private suspend fun processConversation(
        adapter: PlatformAdapter,
        context: ConversationContext,
        chatRoot: AccessibilityNodeInfo,
        leaseToken: String,
        latestListPreview: String = "",
    ) {
        val interactionEpoch = GestureMonitor.interactionEpoch()
        val conversationStartedAt = System.currentTimeMillis()
        state = EngineState.ReadingMessages
        RuntimeJournal.stateChange("Idle", "ReadingMessages")

        try {
            var root = chatRoot
            // 带上列表预览：Soul 会把多个会话缓存在同一页，读取时要挑出当前那一组。
            var messages = readMessagesWithRetry(
                adapter, context.contactName, leaseToken, latestListPreview
            )
            // Soul 互动表情本地识别
            if (adapter is com.aaiagent.adapter.SoulAdapter) {
                val recognition = adapter.recognizePendingStickers(
                    messages = messages,
                    expectedLatestPreview = latestListPreview
                )
                messages = recognition.messages
            }
            // 2026-10-06 真机：她自己的消息混在中间时也要认出来（原来只查最后一条）。
            // 认不出来就会被当成对方的新消息，于是同一句被回两遍。
            val filteredOwnBubbles = replyDeliveryVerifier.withoutOwnBubbles(context, messages)
            if (filteredOwnBubbles.size != messages.size) {
                android.util.Log.d(
                    "AIA",
                    "own bubbles filtered=${messages.size - filteredOwnBubbles.size} contact=${context.contactName}"
                )
                messages = filteredOwnBubbles
            }
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) returnToMessageList(adapter, leaseToken, "empty chat")
                return
            }
            // 不再自动滚动聊天记录。长会话如果眼前不是最新位置，就放弃这一轮，
            // 宁可少回，也不能拿旧窗口硬回。
            val readFresh = chatReadMatchesListPreview(messages, latestListPreview)
            if (!readFresh) {
                RuntimeJournal.recovery(
                    "聊天页可见内容不是最新，已跳过不猜 contact=${context.contactName}"
                )
                android.util.Log.d(
                    "AIA",
                    "chat visible window stale contact=${context.contactName} " +
                        "preview=${latestListPreview.take(24)} last=${messages.lastOrNull()?.content?.take(24)}"
                )
                if (messages.size > SHORT_CONVERSATION_MAX_MESSAGES) {
                    if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) {
                        returnToMessageList(adapter, leaseToken, "chat read not latest")
                    }
                    return
                }
            }
            if (messages.isEmpty()) {
                RuntimeJournal.readMessages(0, "")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) {
                    returnToMessageList(adapter, leaseToken, "empty chat after refresh")
                }
                return
            }
            android.util.Log.d(
                "AIA",
                "chat_timing stage=read elapsed=${System.currentTimeMillis() - conversationStartedAt} messages=${messages.size}"
            )
            enqueueSnapshot(context, messages)
            val deliveryFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(messages)

            val pendingWasStale = synchronized(context) { context.pendingReplyStale }
            val pendingParts = synchronized(context) { context.pendingReplyParts.toList() }
            val pendingSentParts = synchronized(context) { context.pendingReplySentParts }
            val pendingTotalParts = synchronized(context) { context.pendingReplyTotalParts }
            if (ReplyDeliveryPolicy.nextPartDecision(
                    sentParts = pendingSentParts,
                    incomingChanged = false,
                    staleRequested = pendingWasStale
                ) == NextPartDecision.CANCEL_STALE
            ) {
                val staleBatchFingerprint = synchronized(context) {
                    context.pendingReplyBatchFingerprint
                }
                synchronized(context) {
                    if (staleBatchFingerprint.isNotBlank()) {
                        context.lastRepliedIncomingFingerprint = staleBatchFingerprint
                    }
                }
                clearPendingReply(context)
                removeConversationRecovery(context)
                android.util.Log.d("AIA", "stale pending reply discarded before delivery")
                return
            }
            val outstandingReplyId = synchronized(context) { context.pendingReplyId }
            if (pendingParts.isEmpty() && outstandingReplyId.isNotBlank()) {
                if (replyConfirmationQueue.confirmPendingReply(context)) {
                    synchronized(context) {
                        if (context.pendingReplyBatchFingerprint.isNotBlank()) {
                            context.lastRepliedIncomingFingerprint = context.pendingReplyBatchFingerprint
                        }
                    }
                    clearPendingReply(context)
                    removeConversationRecovery(context)
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
                val incomingChanged = ReplyDeliveryPolicy.incomingChanged(
                    pendingFingerprint,
                    deliveryFingerprint
                )
                val staleRequested = synchronized(context) { context.pendingReplyStale }
                if (ReplyDeliveryPolicy.nextPartDecision(
                        sentParts = pendingSentParts,
                        incomingChanged = incomingChanged,
                        staleRequested = staleRequested
                    ) == NextPartDecision.CANCEL_STALE
                ) {
                    synchronized(context) { context.pendingReplyStale = true }
                    clearPendingReply(context)
                    removeConversationRecovery(context)
                    android.util.Log.d("AIA", "pending reply invalidated before the first part")
                    return
                }
                if (incomingChanged || staleRequested) {
                    android.util.Log.d(
                        "AIA",
                        "finishing partial reply before handling newer incoming part=${pendingSentParts + 1}"
                    )
                }
                state = EngineState.AboutToSend
                val pendingTraceId = synchronized(context) { context.pendingReplyId }
                    .ifBlank { "retry-${context.contactId}-${System.currentTimeMillis()}" }
                val delivery = deliverReplyParts(
                    adapter = adapter,
                    context = context,
                    parts = pendingParts,
                    expectedIncomingFingerprint = pendingFingerprint,
                    leaseToken = leaseToken,
                    interactionEpoch = interactionEpoch,
                    initialSentParts = pendingSentParts,
                    totalParts = pendingTotalParts.coerceAtLeast(pendingSentParts + pendingParts.size),
                    traceId = pendingTraceId,
                )
                if (delivery.isComplete && delivery.confirmed) {
                    synchronized(context) {
                        if (pendingBatchFingerprint.isNotBlank()) {
                            context.lastRepliedIncomingFingerprint = pendingBatchFingerprint
                        }
                    }
                    clearPendingReply(context)
                    removeConversationRecovery(context)
                    if (HostingCompletionPolicy.shouldReturnToMessageList(
                            mode = hostingMode,
                            sentAny = true,
                            automationStillOwned = canContinue(leaseToken, interactionEpoch)
                        )
                    ) {
                        // Always hand the screen back to the list right after a
                        // reply: other waiting contacts come first, and a message
                        // that lands immediately after ours is picked up by the
                        // recent-contact revisit or the next scan.
                        state = EngineState.ScanningConversations
                        returnToMessageList(adapter, leaseToken, "pending reply sent")
                    }
                } else if (delivery.isComplete) {
                    android.util.Log.w("AIA", "reply sent but backend confirmation failed; retry on next scan")
                }
                if (delivery.status == ReplyDeliveryStatus.STALE) {
                    if (delivery.sentParts == 0) clearPendingReply(context)
                    else synchronized(context) { context.pendingReplyStale = true }
                    if (delivery.sentParts == 0) removeConversationRecovery(context)
                    queueStaleRetry(context)
                    delay(STALE_REPLY_COOLDOWN_MS)
                }
                return
            }

            val lastMessage = messages.lastOrNull() ?: return
            val directBatch = if (
                isUndetectedOwnBubble(context, lastMessage) ||
                !ConversationReplyPolicy.shouldReply(lastMessage.sender)
            ) {
                null
            } else {
                IncomingMessageBatch.select(messages)
            }
            val transcriptFollowUp = if (directBatch == null) {
                TranscriptFollowUpPolicy.find(messages) { candidate ->
                    synchronized(context) {
                        context.hasRepliedToIncoming(incomingContentKey(candidate))
                    }
                }
            } else {
                null
            }
            val incomingBatch = directBatch
                ?: transcriptFollowUp?.let(IncomingMessageBatch::transcriptFollowUp)
                ?: run {
                    android.util.Log.d("AIA", "conversation has no unanswered incoming message")
                    RuntimeJournal.recovery("无需回复: 最后一条为本人消息 contact=${context.contactName}")
                    if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) {
                        returnToMessageList(adapter, leaseToken, "no unanswered incoming message")
                    }
                    return
                }
            if (directBatch == null && transcriptFollowUp != null) {
                RuntimeJournal.recovery(
                    "语音转写后补回复 contact=${context.contactName} text=${transcriptFollowUp.transcript.take(30)}"
                )
            }
            android.util.Log.d(
                "AIA",
                "last bubble is incoming; processing reply content=${lastMessage.content.take(30)}"
            )
            val latestIncoming = incomingBatch.latestIncoming
            // 2026-10-05：同一条对方消息只回一次。真机出现过同一批“哈哈哈/有点累哟”被回 4 次。
            val latestIncomingKey = incomingContentKey(latestIncoming)
            // 只有“这轮读得不新鲜”时才用已回记录拦截；读得新鲜就正常回，避免同一句话被误判成重复。
            if (!readFresh && synchronized(context) { context.hasRepliedToIncoming(latestIncomingKey) }) {
                RuntimeJournal.recovery("这条消息已经回过了，跳过 contact=${context.contactName}")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) {
                    returnToMessageList(adapter, leaseToken, "incoming already answered")
                }
                return
            }
            android.util.Log.d(
                "AIA",
                "incoming batch size=${incomingBatch.incoming.size} focus=${if (incomingBatch.preferTextOnly) "text" else incomingBatch.mediaTarget?.type ?: "text"} media=${incomingBatch.mediaTarget?.type ?: "none"} latest=${latestIncoming.content}"
            )
            RuntimeJournal.readMessages(messages.size, latestIncoming.content)
            val incomingBatchFingerprint = IncomingMessageBatch.fingerprint(incomingBatch)
            val ignoredIncomingFingerprint = synchronized(context) {
                context.lastIgnoredIncomingFingerprint
            }
            if (IncomingConversationTracker.isAlreadyHandled(
                    handledFingerprint = ignoredIncomingFingerprint,
                    currentFingerprint = incomingBatchFingerprint
                )
            ) {
                android.util.Log.d("AIA", "incoming farewell already handled, skip duplicate generation")
                if (HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode)) {
                    returnToMessageList(adapter, leaseToken, "incoming farewell already handled")
                }
                return
            }
            if (hostingMode == HostingMode.SEMI_AUTO &&
                IncomingConversationTracker.isAlreadyHandled(
                    handledFingerprint = context.lastRepliedIncomingFingerprint,
                    currentFingerprint = incomingBatchFingerprint
                )
            ) {
                android.util.Log.d("AIA", "semi-auto reply already filled, skip duplicate generation")
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
            val reply = run {
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
                val understanding = withLeaseHeartbeat(leaseToken) {
                    understandIncomingBatch(
                        adapter = adapter,
                        root = root,
                        messages = IncomingMessageBatch.replyMessages(incomingBatch),
                        incomingBatch = incomingBatch,
                        api = api,
                        token = token,
                        leaseToken = leaseToken,
                        interactionEpoch = interactionEpoch,
                        context = context
                    )
                }
                val replyMessages = understanding.messages
                if (understanding.retryInPlace) {
                    RuntimeJournal.recovery("媒体加载未完成，保留聊天页下次重试: ${understanding.reason}")
                    delay(1_000)
                    state = EngineState.Idle
                    return
                }

                withLeaseHeartbeat(leaseToken) {
                    requestReply(
                        adapter = adapter,
                        context = context,
                        messages = replyMessages,
                        api = api,
                        token = token,
                        leaseToken = leaseToken,
                        interactionEpoch = interactionEpoch,
                        initialDeliveryFingerprint = deliveryFingerprint,
                        initialIncomingBatchFingerprint = incomingBatchFingerprint
                    )
                } ?: return
            }

            if (!canContinue(leaseToken, interactionEpoch)) {
                android.util.Log.w(
                    "AIA",
                    "automation ownership lost before send contact=${context.contactName}"
                )
                RuntimeJournal.messageSent(false, "发送前自动化已失去控制权，本轮回复作废")
                return
            }
            if (!prepareChatBeforeAction(adapter, context, leaseToken)) return
            when (HostingCompletionPolicy.replyAction(hostingMode)) {
                HostingReplyAction.SEND -> {
                    state = EngineState.AboutToSend
                    val sendDeliveryFingerprint = ReplyDeliveryPolicy.effectiveFingerprint(
                        reply.deliveryFingerprint,
                        deliveryFingerprint
                    )
                    val sendIncomingBatchFingerprint = ReplyDeliveryPolicy.effectiveFingerprint(
                        reply.incomingBatchFingerprint,
                        incomingBatchFingerprint
                    )
                    val selectedMedia = reply.media
                    val delivery = if (selectedMedia != null) {
                        if (!TopicMediaReplyPolicy.shouldSendAutomatically(hostingMode, selectedMedia)) {
                            RuntimeJournal.recovery("topic media blocked by hosting mode")
                            return
                        }
                        deliverTopicMedia(
                            adapter = adapter,
                            context = context,
                            media = selectedMedia,
                            replyId = reply.replyId,
                            deliveryFingerprint = sendDeliveryFingerprint,
                            leaseToken = leaseToken,
                            interactionEpoch = interactionEpoch,
                            teaserText = reply.content,
                            incomingBatchFingerprint = sendIncomingBatchFingerprint
                        )
                    } else {
                        sendReply(
                            adapter = adapter,
                            context = context,
                            reply = reply.content,
                            replyId = reply.replyId,
                            incomingBatchFingerprint = sendIncomingBatchFingerprint,
                            deliveryFingerprint = sendDeliveryFingerprint,
                            selfLeaveCooldownMs = reply.selfLeaveCooldownMs,
                            leaseToken = leaseToken,
                            interactionEpoch = interactionEpoch,
                            // 媒体"要了但没选出来"时也会走到这里 —— 必须让语音岔路口知道，
                            // 否则它会把"那就只发一张"发成语音，照片永远发不出去。
                            mediaExpected = reply.mediaExpected
                        )
                    }
                    if (delivery.isComplete && delivery.confirmed) {
                        synchronized(context) {
                            context.lastRepliedIncomingFingerprint = sendIncomingBatchFingerprint
                            context.rememberRepliedIncoming(latestIncomingKey)
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
                        if (delivery.sentParts == 0) clearPendingReply(context)
                        else synchronized(context) { context.pendingReplyStale = true }
                        android.util.Log.d("AIA", "reply delivery stopped because newer messages arrived")
                        queueStaleRetry(context)
                        delay(STALE_REPLY_COOLDOWN_MS)
                    }
                }
                HostingReplyAction.FILL_INPUT_ONLY -> {
                    if (adapter is SoulAdapter) {
                        if (adapter.fillInputOnly(reply.content, context.contactName)) {
                            synchronized(context) {
                                context.lastRepliedIncomingFingerprint = incomingBatchFingerprint
                            }
                        }
                    }
                }
                HostingReplyAction.OBSERVE_ONLY -> Unit
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            RuntimeJournal.recovery("处理会话异常: ${error.message}")
            android.util.Log.e("AIA", "processConversation failed", error)
            // Recover the page first, then let the hosting loop continue. Keeping
            // the engine in Error left the automation idle until the state
            // watchdog fired, which looked like a freeze to the user.
            val recoveryService = service
            if (recoveryService != null) {
                try {
                    ErrorRecovery.recoverSend(adapter, recoveryService)
                } catch (_: Exception) {
                }
            }
            state = EngineState.Idle
        } finally {
            if (state != EngineState.Error) state = EngineState.Idle
        }
    }

    /**
     * Soul reports a bubble as incoming whenever its avatars and bubble geometry
     * cannot be resolved. If that text is exactly something this automation just
     * sent in this conversation, trusting the fallback would make the agent
     * answer its own message, so the bubble is treated as ours instead.
     */
    private fun isUndetectedOwnBubble(
        context: ConversationContext,
        message: PlatformAdapter.ChatMessage,
    ): Boolean {
        val sent = synchronized(context) { context.aiSentContents.toSet() }
        if (sent.isEmpty()) return false
        val own = UndetectedOwnBubblePolicy.isOwnBubble(
            sender = message.sender,
            type = message.type,
            content = message.content,
            sentByAutomation = sent,
        )
        if (own) {
            android.util.Log.d("AIA", "undetected own bubble ignored contact=${context.contactName}")
        }
        return own
    }

    private suspend fun readMessagesWithRetry(
        adapter: PlatformAdapter,
        expectedContactName: String,
        leaseToken: String,
        expectedPreview: String = "",
    ): List<PlatformAdapter.ChatMessage> {
        var overlaySeen = false
        var nonOverlayAttemptsAfterOverlay = 0
        repeat(READ_MESSAGE_RETRIES) { attempt ->
            if (!canContinue(leaseToken, null)) return emptyList()
            val svc = service ?: return emptyList()
            val root = svc.rootInActiveWindow ?: return emptyList()
            val hasOverlay = adapter.hasTransientOverlay(root)
            if (hasOverlay) {
                overlaySeen = true
                nonOverlayAttemptsAfterOverlay = 0
            }
            if (!adapter.isInChat(root)) {
                val shouldRecover = ChatPageStabilityPolicy.shouldRecoverWrongPage(
                    attempt = attempt,
                    hasTransientOverlay = hasOverlay,
                    overlaySeen = overlaySeen,
                    nonOverlayAttemptsAfterOverlay = nonOverlayAttemptsAfterOverlay,
                )
                if (!adapter.isInMessageList(root) && shouldRecover) {
                    val back = adapter.navigateToMessageList(
                        svc,
                        root,
                    )
                    RuntimeJournal.log(
                        "页面不对",
                        if (back) "已退回消息列表" else "退回失败",
                        "目标=$expectedContactName",
                    )
                    if (back) return emptyList()
                }
                val delayMs = ChatPageStabilityPolicy.retryDelayMs(
                    attempt = attempt,
                    hasTransientOverlay = hasOverlay,
                    overlayRecentlyCleared = overlaySeen && !hasOverlay && nonOverlayAttemptsAfterOverlay == 0,
                )
                if (!hasOverlay && overlaySeen) {
                    nonOverlayAttemptsAfterOverlay++
                }
                if (delayMs > 0L) delay(delayMs)
                return@repeat
            }
            chatPageIdentityTracker.rememberConfirmedTitle(
                windowId = root.windowId,
                expectedContact = expectedContactName,
                actualTitle = adapter.readChatTitle(root),
            )
            val messages = adapter.readMessages(root, expectedPreview)
            if (messages.isNotEmpty()) {
                val previewMatches = chatReadMatchesListPreview(messages, expectedPreview)
                when (observeChatIdentity(
                    adapter = adapter,
                    root = root,
                    expectedContactName = expectedContactName,
                    previewMatches = previewMatches,
                )) {
                    ChatPageIdentityDecision.CONFIRMED,
                    ChatPageIdentityDecision.READ_ONLY,
                    -> return MessageJunkPolicy.filterBatch(messages)
                    ChatPageIdentityDecision.WAIT -> {
                        delay(CHAT_IDENTITY_RETRY_DELAY_MS)
                        return@repeat
                    }
                    ChatPageIdentityDecision.NOT_CHAT -> {
                        adapter.navigateToMessageList(
                            svc,
                            root,
                        )
                        RuntimeJournal.log(
                            "聊天页身份",
                            "聊天页身份未确认，已退回消息列表",
                            "目标=$expectedContactName",
                        )
                        return emptyList()
                    }
                }
            }
            delay(1_000)
        }
        val finalRoot = service?.rootInActiveWindow
        if (finalRoot != null && !adapter.isInMessageList(finalRoot)) {
            adapter.navigateToMessageList(service ?: return emptyList(), finalRoot)
        }
        RuntimeJournal.log(
            "聊天页身份",
            "联系人标题一直未确认，已退回消息列表",
            "目标=$expectedContactName",
        )
        return emptyList()
    }

    /** 内容级身份：跨多次读取稳定（相对时间标签会变，所以不带时间）。 */
    private fun incomingContentKey(message: PlatformAdapter.ChatMessage): String {
        return listOf(
            message.sender,
            message.type,
            message.content.trim().replace(Regex("\\s+"), " ")
        ).joinToString("|")
    }

    private fun chatReadMatchesListPreview(
        messages: List<PlatformAdapter.ChatMessage>,
        listPreview: String
    ): Boolean = ChatReadFreshnessPolicy.matches(messages, listPreview)

    private suspend fun understandIncomingBatch(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        messages: List<PlatformAdapter.ChatMessage>,
        incomingBatch: IncomingMessageBatch.Selection,
        api: ApiService,
        token: String,
        leaseToken: String,
        interactionEpoch: Long,
        context: ConversationContext
    ): MediaUnderstanding {
        val mediaTarget = incomingBatch.mediaTarget ?: return MediaUnderstanding(messages)
        if (mediaTarget.type == SoulInteractionMessage.TYPE) {
            InteractionVisionCache.get(mediaTarget.identityKey)?.let { cached ->
                android.util.Log.d("AIA", "interaction vision cache hit key=${mediaTarget.identityKey}")
                return MediaUnderstanding(
                    replaceLatest(
                        messages,
                        mediaTarget,
                        ImageUnderstandingPolicy.modelFacts(mediaTarget.type, cached)
                    )
                )
            }
        }
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
                // 2026-10-07 真机（渔夫 2 秒语音）：转写报告成功，重读却没拿到文字，
                // 下面的回退就用旧的 [语音] 去问模型 → 模型只好编“没听清”。
                // 现在重读最多 3 次，必须确认内容里真带上了转写文字；都不行就明确记一条日志。
                var spoken: List<ChatMessage>? = null
                var attempt = 0
                while (attempt < 3 && spoken == null) {
                    val refreshed = adapter.readMessages(svc.rootInActiveWindow ?: root)
                    val incoming = IncomingMessageBatch.select(refreshed)?.incoming
                    if (incoming != null && VoiceTranscriptPolicy.hasSpokenText(incoming)) {
                        spoken = incoming
                        break
                    }
                    if (VoiceTranscriptPolicy.shouldRetry(attempt)) {
                        android.util.Log.d(
                            "AIA",
                            "voice transcript not visible yet, reread attempt=" + (attempt + 1)
                        )
                        delay(300)
                    }
                    attempt += 1
                }
                if (spoken != null) return MediaUnderstanding(spoken)
                RuntimeJournal.log(
                    "语音转写",
                    "重读没拿到文字",
                    "contact=" + context.contactName + "（本轮按“没有文字”处理）"
                )
                android.util.Log.w("AIA", "voice transcript lost after rereads contact=" + context.contactName)
            }
        }

        var exchangeReply: ChatResponse? = null
        var exchangeImageBytes: ByteArray? = null
        if (mediaTarget.type == "exchange") {
            if (!ExchangeMediaPolicy.shouldStageDaily(hostingMode)) {
                return MediaUnderstanding(messages)
            }
            val exchangeRequestId = ExchangeMediaPolicy.requestId(
                contactId = context.contactId,
                identityKey = mediaTarget.identityKey,
                content = mediaTarget.content
            )
            val selected = try {
                api.selectExchangeMedia(
                    ExchangeMediaRequest(
                        token = token,
                        platform = currentPlatform,
                        hostingMode = TopicMediaReplyPolicy.wireHostingMode(hostingMode),
                        requestId = exchangeRequestId,
                        contactId = context.contactId,
                        contactName = context.contactName
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                RuntimeJournal.recovery("exchange daily media request failed: ${error.message}")
                return MediaUnderstanding(messages, retryInPlace = true, reason = "exchange daily media unavailable")
            }
            if (selected.action != "send_media" || !TopicMediaReplyPolicy.isCompleteMedia(selected.media)) {
                // 后端明确说"跳过"时**绝不能重试** —— 那是最终答复，重试一万次也还是 skip。
                // 真机事故（2026-10-06 19:01）：每 6 秒重来一次、无限循环、白耗电，
                // 聊天页还被一直占着。判成不重试之后继续往下走，她会用文字/语音回应对方。
                if (!ExchangeMediaPolicy.shouldRetryAfterSelection(selected.action)) {
                    RuntimeJournal.recovery(
                        "后端跳过以图换图（${selected.error ?: selected.action.orEmpty()}），不再重试"
                    )
                    return MediaUnderstanding(messages)
                }
                RuntimeJournal.recovery("exchange daily media skipped: ${selected.error ?: selected.action.orEmpty()}")
                return MediaUnderstanding(messages, retryInPlace = true, reason = "exchange daily media unavailable")
            }
            exchangeReply = selected
            exchangeImageBytes = try {
                api.downloadMedia(token, selected.media!!)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                RuntimeJournal.recovery("exchange daily media download failed: ${error.message}")
                return MediaUnderstanding(messages, retryInPlace = true, reason = "exchange daily media unavailable")
            }
        }

        val prompt = ImageUnderstandingPolicy.VISION_PROMPT
        val preparation = adapter.prepareVisualCapture(root, mediaTarget.type, exchangeImageBytes)
        if (preparation == null) {
            RuntimeJournal.recovery("隐私图片展开失败 type=${mediaTarget.type}")
            return MediaUnderstanding(messages, retryInPlace = true, reason = "图片展开失败")
        }
        if (preparation.exchangeSubmitted) {
            val pending = exchangeReply
            val media = pending?.media
            val replyId = pending?.replyId
            if (replyId != null && media != null) {
                val confirmed = api.confirmChatReply(
                    token = token,
                    replyId = replyId,
                    sentContent = TopicMediaReplyPolicy.confirmationContent(media)
                )
                if (!confirmed) RuntimeJournal.recovery("exchange daily media confirmation failed")
            }
        }
        val preparedRoot = preparation.root
        android.util.Log.d(
            "AIA",
            "visual page prepared type=${mediaTarget.type} privacy=${preparation.privacyProtected}"
        )
        // 2026-10-07 用户要求：隐私图/闪照根本不用截图，直接走“随口夸一句”那条路。
        // 以前是先截图、只有截不到才回退，结果把悬浮窗拍进图里，露了“托管”的字眼。
        val imageBase64 = try {
            if (preparation.privacyProtected) {
                android.util.Log.d("AIA", "privacy image: skip screenshot, use privacy reply")
                null
            } else {
                ScreenCapture.captureJpegBase64(
                    service = svc,
                    targetBounds = adapter.readVisualTargetBounds(preparedRoot, mediaTarget.type),
                    rejectMostlyBlack = false
                )
            }
        } finally {
            adapter.finishVisualCapture(preparedRoot)
        }
        if (restoreAfterVisualCapture(
                svc = svc,
                adapter = adapter,
                expectedContactName = context.contactName,
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

        val modelFacts = if (mediaTarget.type == SoulMomentCard.TYPE) {
            // 卡片正文已经从节点读好了，这里只把配图的客观描述补在后面。
            ImageUnderstandingPolicy.momentCardFacts(mediaTarget.content, vision.description)
        } else {
            ImageUnderstandingPolicy.modelFacts(mediaTarget.type, vision.description)
        }
        if (mediaTarget.type == SoulInteractionMessage.TYPE) {
            InteractionVisionCache.put(mediaTarget.identityKey, vision.description)
        }

        return MediaUnderstanding(
            replaceLatest(
                messages,
                mediaTarget,
                modelFacts
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
                when {
                    root == null -> Unit
                    root.packageName?.toString() != adapter.packageName ->
                        adapter.bringToForeground(svc)
                    adapter.isInChat(root) ->
                        svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    else -> Unit
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
        interactionEpoch: Long,
        initialDeliveryFingerprint: String,
        initialIncomingBatchFingerprint: String
    ): ReplySuggestion? {
        state = EngineState.WaitingLLM
        val requestStartedAtNanos = System.nanoTime()
        val location = withContext(Dispatchers.IO) { repository.getLocation() }
        var requestMessages = IncomingMessageBatch.requestMessages(messages)
        var latestVisibleMessages = messages
        var mergeChangeCount = IncomingMessageBatch
            .select(messages)
            ?.incoming
            ?.size
            ?.coerceAtLeast(1)
            ?: 1
        var latestDeliveryFingerprint = initialDeliveryFingerprint
        var latestIncomingBatchFingerprint = initialIncomingBatchFingerprint
        var conversationTimeline = UnansweredTimeline.build(
            IncomingMessageBatch.select(requestMessages)?.incoming ?: requestMessages
        )
        var recalcCount = 0
        var latestIncomingStableToken = requestMessages
            .lastOrNull()
            ?.let(IncomingMessageBatch::stableToken)
            .orEmpty()
        var requestId = ReplyRequestIdPolicy.build(
            platform = currentPlatform,
            contactId = context.contactId,
            latestIncomingStableToken = latestIncomingStableToken,
            incomingBatchFingerprint = initialIncomingBatchFingerprint,
            historyFingerprint = initialDeliveryFingerprint,
        )
        RuntimeJournal.trace(
            TraceEvent(
                traceId = requestId,
                event = "turn_started",
                platform = currentPlatform,
                contactId = context.contactId,
                stage = "merge",
                result = "waiting",
            )
        )
        contactSyncScheduler.schedule(api, token, context.contactId, context.contactName)

        // 2026-10-05 真机（谭波）：新鲜窗口原来从“进会话”就开始算，读页面花了 10 秒，
        // 模型回完已经 17 秒 > 8 秒窗口，回复被当过期丢掉 → 重新进会话重来，用户看到“不回复还退出”。
        // 改成从真正发请求的这一刻开始算。
        synchronized(context) { context.firstMessageAt = System.currentTimeMillis() }
        // Hold the first model call until the incoming turn has been quiet for a
        // short window, while keeping a hard cap so a long burst still gets a reply.
        // 2026-10-05：只有对方刚发出来（3 秒内）才等这个窗口；回几分钟前的未读直接发请求，
        // 实测能把手机端发请求前的 4~6 秒砍掉。
        val mergeStartedAtMs = System.currentTimeMillis()
        var mergeLastChangeAtMs = mergeStartedAtMs
        val newestIncomingAtMs = messages.lastOrNull { it.sender != "self" }?.timestampMillis ?: 0L
        val newestIncomingAgeMs = if (newestIncomingAtMs > 0L) {
            System.currentTimeMillis() - newestIncomingAtMs
        } else {
            Long.MAX_VALUE
        }
        android.util.Log.d(
            "AIA",
            "chat merge window newest_age_ms=$newestIncomingAgeMs wait=${ReplyFreshnessPolicy.shouldWaitForMerge(newestIncomingAgeMs)}"
        )
        while (ReplyFreshnessPolicy.shouldWaitForMerge(newestIncomingAgeMs)) {
            delay(ReplyFreshnessPolicy.INITIAL_MERGE_POLL_MS)
            if (!canContinue(leaseToken, interactionEpoch)) return null

            val nowMs = System.currentTimeMillis()
            val mergeRoot = service?.rootInActiveWindow
            if (mergeRoot != null &&
                replyDeliveryVerifier.verifyCurrentChat(adapter, context.contactName)
            ) {
                val freshMessages = adapter.readMessages(mergeRoot)
                val freshBatch = IncomingMessageBatch.select(freshMessages)
                val changeKind = IncomingMessageBatch.classifyChange(
                    previous = latestVisibleMessages,
                    current = freshMessages,
                )
                latestVisibleMessages = freshMessages
                if (freshBatch != null && changeKind != IncomingMessageBatch.ChangeKind.SAME &&
                    changeKind != IncomingMessageBatch.ChangeKind.SELF_APPENDED
                ) {
                    val freshBatchFingerprint = IncomingMessageBatch.fingerprint(freshBatch)
                    if (ReplyDeliveryPolicy.incomingChanged(
                            latestIncomingBatchFingerprint,
                            freshBatchFingerprint
                        )
                    ) {
                        requestMessages = freshBatch.incoming
                        latestDeliveryFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(freshMessages)
                        latestIncomingBatchFingerprint = freshBatchFingerprint
                        latestIncomingStableToken = freshBatch.incoming
                            .lastOrNull()
                            ?.let(IncomingMessageBatch::stableToken)
                            .orEmpty()
                        conversationTimeline = UnansweredTimeline.build(freshBatch.incoming)
                        mergeLastChangeAtMs = nowMs
                        mergeChangeCount += 1
                        synchronized(context) {
                            context.lastIncomingFingerprint = latestDeliveryFingerprint
                            context.firstMessageAt = nowMs
                        }
                    }
                }
            }

            when (ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = mergeStartedAtMs,
                lastChangeAtMs = mergeLastChangeAtMs,
                nowMs = nowMs,
                burstCount = mergeChangeCount,
            )) {
                InitialMergeDecision.WAIT -> Unit
                InitialMergeDecision.READY,
                InitialMergeDecision.TIMEOUT -> break
            }
        }
        synchronized(context) {
            context.pendingReplyStale = false
            context.lastIncomingFingerprint = latestDeliveryFingerprint
        }
        if (!canContinue(leaseToken, interactionEpoch)) return null

        // 本机昵称由用户手填、按平台存，每轮只读一次就够（见 SelfNicknamePolicy）。
        val selfNickname = withContext(Dispatchers.IO) {
            SelfNicknamePolicy.forRequest(
                repository.getConfig(SelfNicknamePolicy.configKey(currentPlatform))
            )
        }

        repeat(MAX_LLM_RETRIES) {
            if (!canContinue(leaseToken, interactionEpoch)) return null
            val freshnessRequestId = synchronized(context) { context.llmRequestId }
            conversationTimeline = UnansweredTimeline.build(
                IncomingMessageBatch.select(requestMessages)?.incoming ?: requestMessages
            )
            android.util.Log.d(
                "AIA",
                "chat request attempt=${it + 1}/$MAX_LLM_RETRIES contact=${context.contactName} messages=${requestMessages.size} requestId=$requestId"
            )
            val httpStartedAtNanos = System.nanoTime()
            val chatCall = try {
                api.chat(
                    ChatRequest(
                        token = token,
                        platform = currentPlatform,
                        hostingMode = TopicMediaReplyPolicy.wireHostingMode(hostingMode),
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
                        conversationTimeline = conversationTimeline,
                        conversationStage = context.conversationStage.name.lowercase(),
                        relationshipOrigin = context.relationshipOrigin.name.lowercase(),
                        selfNickname = selfNickname,
                        location = location
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                android.util.Log.e(
                    "AIA",
                    "chat_timing stage=http status=error attempt=${it + 1} requestId=$requestId " +
                        "client_prepare_ms=${elapsedMillis(requestStartedAtNanos, httpStartedAtNanos)} " +
                        "client_http_ms=${elapsedMillis(httpStartedAtNanos)} " +
                        "client_total_ms=${elapsedMillis(requestStartedAtNanos)}",
                    error
                )
                RuntimeJournal.recovery("调用回复接口失败: ${error.message}")
                delay(900)
                return@repeat
            }
            val response = chatCall.response
            val chatResponse = response
            val networkTiming = chatCall.networkTiming
            if (!chatResponse.personaId.isNullOrBlank() || !chatResponse.modelLine.isNullOrBlank()) {
                AutomationTrace.updateContext(
                    personaId = chatResponse.personaId.orEmpty(),
                    personaVersion = chatResponse.personaVersion ?: 0,
                    modelLine = chatResponse.modelLine.orEmpty(),
                    modelName = chatResponse.modelName.orEmpty(),
                )
            }
            RuntimeJournal.trace(
                TraceEvent(
                    traceId = requestId,
                    event = "model_response",
                    platform = currentPlatform,
                    contactId = context.contactId,
                    stage = "model",
                    elapsedMs = response.timing?.totalMs,
                    result = if (chatResponse.action.isNullOrBlank()) "unknown" else chatResponse.action,
                    reason = chatResponse.code.orEmpty(),
                )
            )
            val clientPrepareMs = elapsedMillis(requestStartedAtNanos, httpStartedAtNanos)
            val clientHttpMs = elapsedMillis(httpStartedAtNanos)
            val clientTotalMs = elapsedMillis(requestStartedAtNanos)
            logModelTiming(
                stage = "http",
                suffix = "attempt=${it + 1}",
                requestId = requestId,
                response = chatResponse,
                networkTiming = networkTiming,
                clientPrepareMs = clientPrepareMs,
                clientHttpMs = clientHttpMs,
                clientTotalMs = clientTotalMs
            )
            android.util.Log.d(
                "AIA",
                "chat response action=${chatResponse.action} replyLength=${chatResponse.reply?.length ?: 0} " +
                    "errorCode=${chatResponse.code.orEmpty()} error=${chatResponse.error.orEmpty()}"
            )
            chatResponse.replyAudit?.let { audit ->
                android.util.Log.d(
                    "AIA",
                    "chat reply_audit source=${audit.source.orEmpty()} " +
                        "reason=${audit.reason.orEmpty()} overrides=" +
                        audit.overrides.joinToString(",") { override ->
                            "${override.rule.orEmpty()}:${override.reason.orEmpty()}"
                        }
                )
                RuntimeJournal.replyDecision(
                    source = audit.source.orEmpty(),
                    reason = audit.reason.orEmpty(),
                    overrides = audit.overrides.map { override ->
                        "${override.rule.orEmpty()}:${override.reason.orEmpty()}"
                    },
                )
                AutomationTrace.recordRuleAudit(
                    source = audit.source.orEmpty(),
                    reason = audit.reason.orEmpty(),
                    overrides = audit.overrides.map { override ->
                        Triple(
                            override.rule.orEmpty(),
                            override.reason.orEmpty(),
                            "${override.before.orEmpty()}=>${override.after.orEmpty()}",
                        )
                    },
                )
            }

            val takeoverReason = chatResponse.reason.orEmpty()
            if (chatResponse.action == "skip" && (takeoverReason == "human_takeover_active" || takeoverReason == "outside_ai_hours")) {
                val waitMs = if (takeoverReason == "outside_ai_hours") 30 * 60 * 1000L else 10 * 60 * 1000L
                contactCooldown.persistLeave(
                    context = context,
                    durationMs = waitMs,
                    reason = takeoverReason,
                )
                RuntimeJournal.recovery("takeover gate: " + takeoverReason)
                returnToMessageList(adapter, leaseToken, "takeover gate, nothing to send")
                return null
            }
            if (chatResponse.action == "skip") {
                val semanticCooldownMs = TemporaryLeavePolicy.semanticExitCooldownMs(
                    error = chatResponse.error,
                    cooldownMs = chatResponse.cooldownMs
                )
                if (semanticCooldownMs != null) {
                    contactCooldown.persistLeave(
                        context = context,
                        durationMs = semanticCooldownMs,
                        reason = "语义暂离"
                    )
                    synchronized(context) {
                        context.lastIgnoredIncomingFingerprint = latestIncomingBatchFingerprint
                    }
                    RuntimeJournal.recovery(
                        "模型判断对方暂离，等待新消息 contact=${context.contactName.ifBlank { context.contactId }}"
                    )
                } else {
                    RuntimeJournal.recovery("后端跳过联系人 ${context.contactName}")
                }
                returnToMessageList(adapter, leaseToken, "backend skip, nothing to send")
                return null
            }
            val isMediaReply = chatResponse.action == "send_media"
            if (chatResponse.code == "llm_upstream_error") {
                contactCooldown.block(
                    context.contactName.ifBlank { context.contactId },
                    ConversationReplyCooldownPolicy.UPSTREAM_ERROR_BLOCK_MS
                )
                RuntimeJournal.recovery(
                    "大模型上游失败，暂停该联系人 " +
                        "${ConversationReplyCooldownPolicy.UPSTREAM_ERROR_BLOCK_MS / 1000} 秒"
                )
            }
            if (!chatResponse.error.isNullOrBlank() ||
                (isMediaReply && !TopicMediaReplyPolicy.isCompleteMedia(chatResponse.media)) ||
                (!isMediaReply && chatResponse.reply.isNullOrBlank())
            ) {
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
                    synchronized(context) {
                        if (ReplyFreshnessPolicy.canAcceptRecomputedReply(
                                requestId = freshnessRequestId,
                                currentRequestId = context.llmRequestId
                            )
                        ) {
                            context.pendingReplyStale = false
                            context.lastIncomingFingerprint = latestDeliveryFingerprint
                        }
                    }
                    logModelTiming(
                        stage = "llm",
                        suffix = "elapsed=$clientTotalMs replyId=${response.replyId.orEmpty()}",
                        requestId = requestId,
                        response = chatResponse,
                        networkTiming = networkTiming,
                        clientPrepareMs = clientPrepareMs,
                        clientHttpMs = clientHttpMs,
                        clientTotalMs = clientTotalMs
                    )
                    return ReplySuggestion(
                        content = response.reply.orEmpty().trim(),
                        replyId = response.replyId,
                        media = response.media,
                        deliveryFingerprint = latestDeliveryFingerprint,
                        incomingBatchFingerprint = latestIncomingBatchFingerprint,
                        selfLeaveCooldownMs = response.selfLeaveMs,
                        mediaExpected = isMediaReply
                    )
                }
                ReplyFreshnessDecision.ABORT_STALE -> {
                    android.util.Log.d("AIA", "discard stale reply and wait for newest messages")
                    if (ReplyFreshnessPolicy.shouldQueueRetryAfterAbort(decision)) {
                        queueStaleRetry(context, delayMs = 0L)
                        wakeSignal.trySend(Unit)
                    }
                    return null
                }
                ReplyFreshnessDecision.RECOMPUTE -> {
                    recalcCount++
                    val freshRoot = service?.rootInActiveWindow ?: return null
                    if (!replyDeliveryVerifier.verifyCurrentChat(adapter, context.contactName)) {
                        return null
                    }
                    val freshMessages = adapter.readMessages(freshRoot)
                    val freshBatch = IncomingMessageBatch.select(freshMessages)
                    if (freshBatch != null) {
                        requestMessages = freshBatch.incoming
                        latestDeliveryFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(freshMessages)
                        latestIncomingBatchFingerprint = IncomingMessageBatch.fingerprint(freshBatch)
                        latestIncomingStableToken = freshBatch.incoming
                            .lastOrNull()
                            ?.let(IncomingMessageBatch::stableToken)
                            .orEmpty()
                    }
                    requestId = ReplyRequestIdPolicy.build(
                        platform = currentPlatform,
                        contactId = context.contactId,
                        latestIncomingStableToken = latestIncomingStableToken,
                        incomingBatchFingerprint = latestIncomingBatchFingerprint,
                        historyFingerprint = latestDeliveryFingerprint,
                    )
                    delay(250)
                }
            }
        }
        return null
    }

    private suspend fun deliverTopicMedia(
        adapter: PlatformAdapter,
        context: ConversationContext,
        media: ChatMedia,
        replyId: String?,
        deliveryFingerprint: String,
        leaseToken: String,
        interactionEpoch: Long,
        // 2026-10-06 用户要求：正常要照片要“欲拒还迎地给”——先说一句再发图。
        teaserText: String? = null,
        incomingBatchFingerprint: String = deliveryFingerprint
    ): ReplyDeliveryResult {
        // 先把她要说的那句发出去，再发照片（后端把这句话放在 reply 字段里）。
        if (!teaserText.isNullOrBlank()) {
            val teaser = sendReply(
                adapter = adapter,
                context = context,
                reply = teaserText,
                replyId = replyId,
                incomingBatchFingerprint = incomingBatchFingerprint,
                deliveryFingerprint = deliveryFingerprint,
                selfLeaveCooldownMs = null,
                leaseToken = leaseToken,
                interactionEpoch = interactionEpoch,
                // **这句说明绝不许转成语音。**
                //
                // 它属于一条媒体回复：说完这句紧接着就要发照片。
                // 真机事故（2026-10-06 18:44）：对方问"看看你照片可以吗"，
                // 后端回 `action=send_media` + 说明"那就只发一张"，
                // 结果说明被语音岔路口接走 —— 合成配音 3 秒、录音发送又几秒，
                // 折腾十来秒之后照片那一步判定 STALE、直接放弃。
                // **她嘴上说"只发一张"，照片永远发不出去。**
                mediaExpected = true
            )
            if (teaser.status == ReplyDeliveryStatus.STOPPED || teaser.status == ReplyDeliveryStatus.STALE) {
                return teaser
            }
        }
        if (!canContinue(leaseToken, interactionEpoch)) {
            return ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, 0, 1)
        }
        if (!replyDeliveryVerifier.incomingStillCurrent(adapter, context, deliveryFingerprint) ||
            synchronized(context) { context.pendingReplyStale }
        ) {
            return ReplyDeliveryResult(ReplyDeliveryStatus.STALE, 0, 1)
        }

        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isBlank()) return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)

        state = EngineState.Sending
        val bytes = try {
            withLeaseHeartbeat(leaseToken) {
                val baseUrl = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
                ApiService(baseUrl).downloadMedia(token, media)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            RuntimeJournal.messageSent(false, "topic media download failed: ${error.message}")
            return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)
        }

        if (!canContinue(leaseToken, interactionEpoch) ||
            !replyDeliveryVerifier.incomingStillCurrent(
                adapter,
                context,
                deliveryFingerprint,
            ) ||
            synchronized(context) { context.pendingReplyStale }
        ) {
            return ReplyDeliveryResult(ReplyDeliveryStatus.STALE, 0, 1)
        }

        val svc = service ?: return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)
        val result = adapter.sendImage(
            service = svc,
            expectedContactName = context.contactName,
            imageBytes = bytes,
            fileName = media.fileName.orEmpty().ifBlank { media.assetId.orEmpty() + ".jpg" },
            contentType = media.contentType.orEmpty().ifBlank { "image/jpeg" },
            canProceed = { canContinue(leaseToken, interactionEpoch) }
        )

        if (result != PlatformAdapter.SendResult.SUCCESS) {
            if (result == PlatformAdapter.SendResult.BANNED) state = EngineState.Error
            RuntimeJournal.messageSent(false, "topic media send failed: $result")
            return ReplyDeliveryResult(
                status = if (result == PlatformAdapter.SendResult.STOPPED) {
                    ReplyDeliveryStatus.STOPPED
                } else {
                    ReplyDeliveryStatus.FAILED
                },
                sentParts = 0,
                totalParts = 1
            )
        }

        val marker = TopicMediaReplyPolicy.confirmationContent(media)
        synchronized(context) {
            context.rememberAutomatedReply(marker)
        }
        val confirmed = if (replyId.isNullOrBlank()) true else {
            replyConfirmationQueue.queueSentReply(replyId, marker)
        }
        RuntimeJournal.messageSent(true, "topic media sent asset=${media.assetId}")
        return ReplyDeliveryResult(
            status = ReplyDeliveryStatus.COMPLETE,
            sentParts = 1,
            totalParts = 1,
            confirmed = confirmed
        )
    }

    private suspend fun sendReply(
        adapter: PlatformAdapter,
        context: ConversationContext,
        reply: String,
        replyId: String?,
        incomingBatchFingerprint: String,
        deliveryFingerprint: String,
        selfLeaveCooldownMs: Long?,
        leaseToken: String,
        interactionEpoch: Long,
        /**
         * 后端这次要的是媒体（`action=send_media`）吗。
         * 为 true 时**绝不用语音** —— 媒体回复里的"那就只发一张"必须跟真实的发照片动作配套，
         * 不能变成一条只说不上手的语音（见 VoiceReplyPolicy.canSpeakAsVoice）。
         */
        mediaExpected: Boolean = false
    ): ReplyDeliveryResult {
        val outgoing = AssistantReplySanitizer.clean(reply)
        if (outgoing.isEmpty()) {
            // 整条内容都是**系统内部标记**（取消息时用来标注气泡类型的那些，
            // 比如后端"待发媒体"返回的 `[图片:daily_04]`）。
            //
            // **绝不能发出去** —— 对方会看到一串记号，直接穿帮。
            // 这里宁可这条不发（返回 FAILED，调用方该发图就发图、该重试就重试），
            // 也绝不让记号出门。真机上换图那条路就会碰到这种回复。
            if (reply.isNotBlank()) {
                RuntimeJournal.recovery("回复内容全是内部标记，已拦下不发: $reply")
                android.util.Log.w("AIA", "reply blocked: internal marker only raw=$reply")
            }
            return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 0)
        }

        // 语音回复：**默认关闭**（见 VoiceReplyPolicy）。
        // 开了、联系人也在名单里、这条又够短，**而且后端这次不是要媒体**，才用语音。
        // 语音这条路任何一步没走通都落回下面的文字流程 —— 绝不让这条回复丢掉。
        if (!mediaExpected && VoiceReplyPolicy.textFitsOneVoice(outgoing)) {
            val (voiceEnabled, voiceContactAllowed) = voiceReplySettings(context)
            if (VoiceReplyPolicy.canSpeakAsVoice(
                    enabled = voiceEnabled,
                    contactAllowed = voiceContactAllowed,
                    mediaExpected = mediaExpected,
                    text = outgoing
                )
            ) {
                val voice = deliverVoiceReply(
                    adapter = adapter,
                    context = context,
                    outgoing = outgoing,
                    replyId = replyId,
                    leaseToken = leaseToken,
                    interactionEpoch = interactionEpoch
                )
                // null = 语音这条路压根没走通（连配音都没准备好）→ 安全落回文字。
                // sentParts > 0 = 已经点过发送，绝不能补文字（对方会收到两条）。
                if (voice != null && (voice.sentParts > 0 || voice.isComplete)) return voice
            }
        }

        val segments = outgoing.split(Regex("\\r?\\n|\\|\\|\\|"))
            .map(String::trim)
            .filter(String::isNotEmpty)
        val rawParts = if (segments.isNotEmpty()) segments else listOf(outgoing.trim())
        val parts = ReplyDeliveryPolicy.planParts(rawParts)
        if (parts.isEmpty()) return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 0)
        android.util.Log.d("AIA", "outgoing reply sanitized segments=${parts.size} length=${outgoing.length}")

        val staleBeforeSend = synchronized(context) {
            if (context.pendingReplyStale) {
                true
            } else {
                context.pendingReplyFullContent = parts.joinToString("|||")
                context.pendingReplyParts.clear()
                context.pendingReplyParts.addAll(parts)
                context.pendingReplyId = replyId.orEmpty()
                context.pendingReplyIncomingFingerprint = deliveryFingerprint
                context.pendingReplyBatchFingerprint = incomingBatchFingerprint
                context.pendingReplySentParts = 0
                context.pendingReplyTotalParts = parts.size
                false
            }
        }
        if (staleBeforeSend) {
            android.util.Log.d("AIA", "reply discarded before send because a newer incoming arrived")
            clearInputField()
            return ReplyDeliveryResult(ReplyDeliveryStatus.STALE, 0, parts.size)
        }
        saveConversationRecovery(context)
        val traceId = replyId.orEmpty()
            .ifBlank { "reply-${context.contactId}-${System.currentTimeMillis()}" }
        RuntimeJournal.trace(
            TraceEvent(
                traceId = traceId,
                event = "delivery_planned",
                platform = context.platform,
                contactId = context.contactId,
                stage = "sending",
                result = "planned",
                reason = "parts=${parts.size}",
            )
        )
        val delivery = deliverReplyParts(
            adapter = adapter,
            context = context,
            parts = parts,
            expectedIncomingFingerprint = deliveryFingerprint,
            leaseToken = leaseToken,
            interactionEpoch = interactionEpoch,
            traceId = traceId,
        )
        if (delivery.isComplete) {
            if (selfLeaveCooldownMs != null && selfLeaveCooldownMs > 0L) {
                contactCooldown.persistLeave(
                    context = context,
                    durationMs = selfLeaveCooldownMs,
                    reason = "模型判断我方主动离场"
                )
            }
        }
        return delivery
    }

    private suspend fun deliverReplyParts(
        adapter: PlatformAdapter,
        context: ConversationContext,
        parts: List<String>,
        expectedIncomingFingerprint: String,
        leaseToken: String,
        interactionEpoch: Long,
        initialSentParts: Int = 0,
        totalParts: Int = initialSentParts + parts.size,
        traceId: String = "",
    ): ReplyDeliveryResult {
        if (parts.isEmpty()) return ReplyDeliveryResult(ReplyDeliveryStatus.COMPLETE, initialSentParts, totalParts)

        val plannedTotal = totalParts.coerceAtLeast(initialSentParts + parts.size).coerceAtLeast(1)
        var sentCount = initialSentParts.coerceIn(0, plannedTotal)
        var replyConfirmed = true
        var stoppedByUser = false
        val deliveryStartedAt = System.currentTimeMillis()
        for ((index, part) in parts.withIndex()) {
            if (!canContinue(leaseToken, interactionEpoch)) {
                android.util.Log.w(
                    "AIA",
                    "reply delivery stopped before part=${index + 1} contact=${context.contactName}"
                )
                RuntimeJournal.messageSent(false, "发送途中自动化失去控制权")
                clearInputField()
                saveConversationRecovery(context)
                return ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, sentCount, plannedTotal)
            }
            if (index == 0) ReplyPaceGate.waitForTurn(context.platform, context.contactId)
            if (index > 0) delay(ReplyDeliveryPolicy.delayAfterPart(part))
            if (!canContinue(leaseToken, interactionEpoch)) {
                android.util.Log.w(
                    "AIA",
                    "reply delivery stopped between parts contact=${context.contactName}"
                )
                RuntimeJournal.messageSent(false, "分段发送途中自动化失去控制权")
                clearInputField()
                saveConversationRecovery(context)
                return ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, sentCount, plannedTotal)
            }
            val incomingChanged = !replyDeliveryVerifier.incomingStillCurrent(
                adapter,
                context,
                expectedIncomingFingerprint
            )
            val staleRequested = synchronized(context) { context.pendingReplyStale }
            val decision = ReplyDeliveryPolicy.nextPartDecision(
                sentParts = sentCount,
                incomingChanged = incomingChanged,
                staleRequested = staleRequested
            )
            if (decision == NextPartDecision.CANCEL_STALE) {
                android.util.Log.d("AIA", "reply delivery invalidated before part=${sentCount + 1}")
                clearInputField()
                clearPendingReply(context)
                removeConversationRecovery(context)
                return ReplyDeliveryResult(ReplyDeliveryStatus.STALE, sentCount, plannedTotal)
            }
            if (incomingChanged || staleRequested) {
                android.util.Log.d(
                    "AIA",
                    "finishing reply delivery before handling newer incoming part=${sentCount + 1} sent=$sentCount"
                )
            }
            if (!replyDeliveryVerifier.verifyCurrentChatWithRetry(adapter, context.contactName)) {
                RuntimeJournal.messageSent(false, "发送前聊天身份未确认")
                clearInputField()
                if (!reopenConversationForDelivery(adapter, context, leaseToken)) {
                    break
                }
                if (!replyDeliveryVerifier.verifyCurrentChatWithRetry(
                        adapter,
                        context.contactName,
                    )
                ) {
                    RuntimeJournal.messageSent(false, "重新打开后聊天身份仍未确认")
                    clearInputField()
                    break
                }
            }
            state = EngineState.Sending
            val svc = service ?: break
            val root = svc.rootInActiveWindow ?: break
            // 2026-10-06 用户报的现象（刚给 A 回的话又出现在 B 的会话）：
            // 发送前再拦一道——同一段长话短时间内在别的联系人那儿出现过，就不发。
            if (recentOutgoingSends.isCrossContactRepeat(part, context.contactId)) {
                android.util.Log.w("AIA", "cross-contact duplicate blocked contact=${context.contactName}")
                RuntimeJournal.messageSent(false, "同一句话刚发给过别的联系人，已拦下: $part")
                break
            }
            // 现场取证：把发送那一刻的会话标题记下来，万一又出现“话说给了别人”，日志能直接定位。
            val titleAtSend = runCatching { adapter.readChatTitle(root) }.getOrNull().orEmpty()
            // 只在不一致“且标题确实读到了”时才放弃；读到空标题（页面重绘瞬间）按原样继续，
            // 否则会重演“发送前验证失败把刚生成好的回复丢掉”。
            val titleUnreadable = titleAtSend.isBlank() || titleAtSend == "unknown"
            if (!titleUnreadable && !ConversationIdentity.matches(context.contactName, titleAtSend)) {
                android.util.Log.w("AIA", "send aborted title mismatch expect=${context.contactName} actual=$titleAtSend")
                RuntimeJournal.messageSent(false, "发送前标题不一致，已放弃 expect=${context.contactName} actual=$titleAtSend")
                break
            }
            val sendTransactionId = AutomationTrace.newTransactionId("send")
            AutomationTrace.recordUiAction(
                platform = context.platform,
                source = "reply_delivery",
                action = "send_reply_part",
                result = "started",
                expectedState = AutomationPageKind.VERIFIED_CHAT.name,
                observedState = AutomationPageKind.VERIFIED_CHAT.name,
                reason = "contact=${context.contactName} part=${index + 1}",
                transactionId = sendTransactionId,
            )
            val visibleBeforeSend = runCatching { adapter.readMessages(root) }
                .getOrDefault(emptyList())
            val alreadyVisible = OutgoingEchoPolicy.shouldSkipSend(part, visibleBeforeSend)
            val result = if (alreadyVisible) {
                android.util.Log.w(
                    "AIA",
                    "send skipped: identical outgoing already visible contact=${context.contactName}"
                )
                PlatformAdapter.SendResult.SUCCESS
            } else {
                adapter.fillAndSend(
                    service = svc,
                    root = root,
                    text = part,
                    expectedContactName = context.contactName,
                    canProceed = { canContinue(leaseToken, interactionEpoch) }
                )
            }
            val observedRoot = service?.rootInActiveWindow
            val observedPage = observedRoot?.let(adapter::observePage)?.kind
                ?: AutomationPageKind.UNKNOWN
            AutomationTrace.recordUiAction(
                platform = context.platform,
                source = "reply_delivery",
                action = "send_reply_part",
                result = result.name.lowercase(),
                expectedState = AutomationPageKind.VERIFIED_CHAT.name,
                observedState = observedPage.name,
                reason = "contact=${context.contactName} part=${index + 1}",
                transactionId = sendTransactionId,
            )
            // 2026-10-07 修“丢话”：NOT_VERIFIED 只说明发送动作自己没确认成功，
            // 不等于没发出去。真机（豆包）：聊天里已经出现这句话，却按失败处理 →
            // 不计数、不确认上传 → 云端永久缺这条。这里补一眼：真看到了就按成功走。
            if (result == PlatformAdapter.SendResult.SUCCESS) ReplyPaceGate.markSent(context.platform, context.contactId)
            val visibleDespiteNotVerified = result == PlatformAdapter.SendResult.NOT_VERIFIED &&
                replyDeliveryVerifier.verifyOutgoingPartVisible(
                    adapter = adapter,
                    context = context,
                    expectedContent = part,
                )
            if (!SendOutcomePolicy.treatedAsSent(result, visibleDespiteNotVerified)) {
                if (result == PlatformAdapter.SendResult.STOPPED) stoppedByUser = true
                RuntimeJournal.messageSent(false, "发送未完成: $result")
                if (result == PlatformAdapter.SendResult.BANNED) {
                    state = EngineState.Error
                    clearPendingReply(context)
                    // 2026-10-06：被平台限制（内容违规/禁言/账号异常）时别反复重试，先冷却这个联系人。
                    contactCooldown.block(context.contactName, SEND_BANNED_BLOCK_MS)
                    RuntimeJournal.recovery("发送被平台限制，暂停该联系人 contact=${context.contactName}")
                    recoverUnknownPageWithVision(
                        adapter = adapter,
                        leaseToken = leaseToken,
                        force = true,
                    )
                }
                clearInputField()
                break
            }
            sentCount++
            recentOutgoingSends.remember(part, context.contactId)
            val visibleAfterSend = replyDeliveryVerifier.verifyOutgoingPartVisible(
                adapter = adapter,
                context = context,
                expectedContent = part,
            )
            RuntimeJournal.messageVerified(
                success = visibleAfterSend,
                detail = "contact=${context.contactName} content=${part.take(30)}",
            )
            RuntimeJournal.trace(
                TraceEvent(
                    traceId = traceId,
                    event = "segment_delivered",
                    platform = context.platform,
                    contactId = context.contactId,
                    stage = "sending",
                    elapsedMs = System.currentTimeMillis() - deliveryStartedAt,
                    result = if (visibleAfterSend) "verified" else "sent_unverified",
                    reason = "part=${sentCount}/${plannedTotal}",
                )
            )
            synchronized(context) {
                context.rememberAutomatedReply(part)
                context.pendingReplySentParts = sentCount
                context.pendingReplyTotalParts = plannedTotal
                context.pendingReplyParts.clear()
                context.pendingReplyParts.addAll(
                    ReplyDeliveryPolicy.remaining(parts, sentCount - initialSentParts)
                )
            }
            saveConversationRecovery(context)
        }

        val completedInBatch = sentCount - initialSentParts
        val remaining = ReplyDeliveryPolicy.remaining(parts, completedInBatch)
        val progress = ReplyDeliveryPolicy.progress(sentCount, plannedTotal)
        synchronized(context) {
            context.pendingReplyParts.clear()
            context.pendingReplyParts.addAll(remaining)
            context.pendingReplySentParts = progress.sentParts
            context.pendingReplyTotalParts = progress.totalParts
            if (remaining.isEmpty()) {
                context.pendingReplyIncomingFingerprint = ""
            }
        }
        if (remaining.isNotEmpty() || synchronized(context) { context.pendingReplyId.isNotBlank() }) {
            saveConversationRecovery(context)
        }
        if (progress.isComplete) {
            replyConfirmed = replyConfirmationQueue.confirmPendingReply(context)
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
        RuntimeJournal.trace(
            TraceEvent(
                traceId = traceId,
                event = "delivery_finished",
                platform = context.platform,
                contactId = context.contactId,
                stage = "sending",
                elapsedMs = System.currentTimeMillis() - deliveryStartedAt,
                result = if (progress.isComplete) "complete" else "incomplete",
                reason = "confirmed=$replyConfirmed remaining=${remaining.size}",
            )
        )
        return ReplyDeliveryResult(
            status = when {
                progress.isComplete -> ReplyDeliveryStatus.COMPLETE
                stoppedByUser -> ReplyDeliveryStatus.STOPPED
                else -> ReplyDeliveryStatus.FAILED
            },
            sentParts = progress.sentParts,
            totalParts = progress.totalParts,
            confirmed = replyConfirmed
        )
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

    private fun clearPendingReply(context: ConversationContext) {
        synchronized(context) {
            context.pendingReplyParts.clear()
            context.pendingReplyId = ""
            context.pendingReplyIncomingFingerprint = ""
            context.pendingReplyBatchFingerprint = ""
            context.pendingReplyFullContent = ""
            context.pendingReplySentParts = 0
            context.pendingReplyTotalParts = 0
            context.pendingReplyStale = false
        }
    }

    private fun conversationKey(contactId: String): String = "$currentPlatform:$contactId"

    private suspend fun enqueueSnapshot(
        context: ConversationContext,
        messages: List<PlatformAdapter.ChatMessage>,
        manualCapture: Boolean = false,
    ) {
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isEmpty() || messages.isEmpty()) return

        val automatedReplies = synchronized(context) { context.aiSentContents.toSet() }
        val platform = context.platform.ifBlank { currentPlatform }
        val stateId = listOf(token, platform, context.contactId).joinToString("\u0000")
        val inserted = withContext(Dispatchers.IO) {
            repository.cleanOldCache()
            val previousState = repository.getConversationSyncState(stateId)
            val previousSnapshot = SyncSnapshotCodec.decode(previousState?.snapshotJson)
            // 2026-10-07（方案 B）：读消息时多数消息拿不到时间（Soul 只在有间隔处显示时间），
            // 以前会写成 0，后端就按“同步时刻”记，云端顺序和手机对不上。
            // 这里统一补时间：以最后一条已知时间为锚点，每条差 1 秒。
            val derivedSeconds = SyncTimePolicy.deriveSeconds(
                millisList = messages.map { it.timestampMillis },
                nowMs = System.currentTimeMillis(),
            )
            val currentSnapshot = messages.mapIndexedNotNull { index, message ->
                val role = if (message.sender == "self") "assistant" else "user"
                val content = message.content.trim()
                if (content.isEmpty()) null else SyncSnapshotItem(
                    role = role,
                    content = content,
                    createdAt = derivedSeconds.getOrNull(index),
                    stableKey = message.identityKey.trim().takeIf(String::isNotEmpty),
                    explicitTime = com.aaiagent.adapter.SoulMessageIdentity.hasExplicitTime(
                        message.timestampText,
                        message.timestampMillis,
                    ),
                    transcript = message.transcript.trim().takeIf(String::isNotEmpty),
                    voiceSeconds = message.voiceSeconds.takeIf { it > 0 },
                )
            }
            val hasEstablishedBaseline = previousState?.snapshotJson?.isNotBlank() == true
            val newIndexes = SyncSnapshotPolicy.selectNewItems(
                previousSnapshot,
                currentSnapshot,
                hasEstablishedBaseline
            )
            var sequence = previousState?.nextSequence ?: 0L
            val outbox = mutableListOf<MessageSyncOutboxEntity>()
            for (index in newIndexes) {
                val item = currentSnapshot[index]
                sequence++
                if (item.role == "assistant" && item.content in automatedReplies) {
                    if (manualCapture) {
                        android.util.Log.d("AIA", "manual sync skipped automated reply")
                    }
                    continue
                }
                val id = SyncMessageKey.build(
                    platform = platform,
                    contactId = context.contactId,
                    role = item.role,
                    content = item.content,
                    sequence = sequence,
                    createdAt = item.createdAt,
                    stableKey = item.stableKey
                )
                outbox += MessageSyncOutboxEntity(
                    id = id,
                    token = token,
                    platform = platform,
                    contactId = context.contactId,
                    contactName = context.contactName,
                    role = item.role,
                    content = item.content,
                    source = if (item.role == "assistant") "human_phone" else "sync",
                    createdAt = item.createdAt ?: (System.currentTimeMillis() / 1000),
                    timeKind = if (item.explicitTime == true) "ui_explicit" else "first_observed",
                    transcript = item.transcript.orEmpty(),
                    voiceSeconds = item.voiceSeconds ?: 0,
                )
            }
            val state = ConversationSyncStateEntity(
                id = stateId,
                platform = platform,
                contactId = context.contactId,
                snapshotJson = SyncSnapshotCodec.encode(currentSnapshot),
                nextSequence = sequence
            )
            repository.persistSyncSnapshot(state, outbox)
        }
        if (inserted > 0) {
            messageSyncOutbox.schedule(force = true)
            messageSyncOutbox.awaitFlush()
        }
    }

    fun onPageChanged(isInChatRoom: Boolean) {
        if (!isInChatRoom) automationOwnedChatKey = null
        android.util.Log.d("AIA", "page changed isInChat=$isInChatRoom state=$state")
    }

    fun onUnexpectedProfilePage(contactName: String) {
        val now = System.currentTimeMillis()
        if (!AutomationRecoveryPolicy.shouldRecoverUnexpectedProfile(
                hostingEnabled = hostingEnabled,
                paused = state == EngineState.Paused,
                userTouchingRecently = GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS),
                lastRecoveryAtMs = lastProfileRecoveryAtMs,
                nowMs = now,
            )
        ) return

        lastProfileRecoveryAtMs = now
        profileRecoveryJob?.cancel()
        profileRecoveryJob = scope.launch {
            val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return@launch
            val reason = "unexpected_profile_page:${contactName.take(40)}"
            RuntimeJournal.recovery("检测到资料页误入，准备自动退回消息列表 contact=$contactName")
            captureIncidentScreenshot("unexpected_profile_before_recovery")
            val result = AutomationActionGate.withPermit(
                owner = "profile-recovery:${currentPlatform.ifBlank { "unknown" }}",
                waitMs = 1_500L,
            ) {
                returnToMessageList(adapter, activeLeaseToken, reason)
                true
            }
            if (result == null) {
                // 没抢到动作许可时不能保留冷却时间，否则后续资料页恢复
                // 会被冷却挡住，页面就会一直停在资料页。
                lastProfileRecoveryAtMs = 0L
            }
            captureIncidentScreenshot("unexpected_profile_after_recovery")
            AutomationTrace.recordUiAction(
                platform = currentPlatform,
                source = "profile_recovery",
                action = "recover_unexpected_profile",
                result = if (result == true) "finished" else "skipped",
                expectedState = AutomationPageKind.CONVERSATION_LIST.name,
                observedState = AutomationPageKind.PROFILE_PAGE.name,
                reason = reason,
            )
        }.also { job ->
            job.invokeOnCompletion {
                if (profileRecoveryJob === job) profileRecoveryJob = null
            }
        }
    }

    fun onNewMessage(
        platform: String,
        message: PlatformAdapter.MessageInfo,
    ) {
        if (!hostingEnabled || state == EngineState.Paused) return
        nextConversationScanAtMs = 0L
        RuntimeJournal.notifyReceived(platform, message.sender, message.content)
        android.util.Log.d(
            "AIA",
            "notification cleared scan cooldown platform=$platform sender=${message.sender}"
        )

        val fingerprint = Deduplicator.fingerprint(platform, message.sender + message.content, "")
        if (Deduplicator.isSeenRecent(fingerprint, DEDUP_WINDOW_MS)) return
        Deduplicator.markSeen(fingerprint)
        val context = activeContext
        if (context != null && context.platform == platform &&
            ConversationIdentity.matches(context.contactName, message.sender)
        ) {
            synchronized(context) {
                context.llmRequestId++
                context.pendingReplyStale = true
            }
            android.util.Log.d("AIA", "notification matched active contact; pending reply marked stale")
        }
        wakeSignal.trySend(Unit)
    }

    fun onContentChanged(platform: String) {
        if (GestureMonitor.isAutomationActionActive()) return
        if (!hostingEnabled) {
            scheduleManualChatSync(platform)
            return
        }
        if (platform != currentPlatform) return
        AutomationTrace.recordContentChange(
            platform = platform,
            engineState = state.toString(),
            source = if (isContentChangeWatchActive(platform, activeContext)) {
                "reply_watch"
            } else {
                "idle_wake"
            },
        )
        if (!isContentChangeWatchActive(platform, activeContext)) {
            val now = System.currentTimeMillis()
            if (now - lastContentChangeWakeAtMs < CONTENT_CHANGE_WAKE_INTERVAL_MS) return
            lastContentChangeWakeAtMs = now
            val visibleUnreadCount = visibleUnreadOnCurrentPage()
            if (visibleUnreadCount > 0) {
                nextConversationScanAtMs = 0L
                android.util.Log.d(
                    "AIA",
                    "visible unread cleared scan cooldown count=$visibleUnreadCount"
                )
            }
            wakeSignal.trySend(Unit)
            return
        }

        val context = activeContext ?: return
        contentChangeStability.record(System.currentTimeMillis())
        if (contentChangeJob?.isActive == true) return
        contentChangeJob = scope.launch {
            inspectStableContentChange(platform, context)
        }
    }

    private fun isContentChangeWatchActive(
        platform: String,
        context: ConversationContext?
    ): Boolean {
        if (context == null || activeContext !== context) return false
        if (platform != currentPlatform || !hostingEnabled) return false
        return state == EngineState.WaitingLLM ||
            state == EngineState.AboutToSend ||
            state == EngineState.Sending
    }

    private fun visibleUnreadOnCurrentPage(): Int {
        val svc = service ?: return 0
        val adapter = adapterRegistry?.getByPlatform(currentPlatform) ?: return 0
        val root = svc.rootInActiveWindow ?: return 0
        if (root.packageName?.toString() != adapter.packageName) return 0
        if (!adapter.isInMessageList(root)) return 0
        return adapter.visibleUnreadCount(root)
    }

    private fun scheduleManualChatSync(platform: String) {
        val adapter = adapterRegistry?.getByPlatform(platform) ?: return
        val title = service?.rootInActiveWindow
            ?.takeIf { root ->
                root.packageName?.toString() == adapter.packageName && adapter.isInChat(root)
            }
            ?.let(adapter::readChatTitle)
            ?.trim()
            .orEmpty()
        val slot = ManualChatSyncPolicy.slotKey(platform, title)

        synchronized(manualChatSyncJobs) {
            manualChatSyncJobs.remove(slot)?.cancel()
            val job = scope.launch {
                delay(ManualChatSyncPolicy.DEBOUNCE_MS)
                if (hostingEnabled) return@launch
                val currentRoot = service?.rootInActiveWindow ?: return@launch
                if (currentRoot.packageName?.toString() != adapter.packageName) return@launch
                val inChat = adapter.isInChat(currentRoot)
                val currentTitle = adapter.readChatTitle(currentRoot)
                if (title.isNotBlank() &&
                    !ConversationIdentity.matches(title, currentTitle)
                ) return@launch
                val messages = if (inChat) adapter.readMessages(currentRoot) else emptyList()
                if (!ManualChatSyncPolicy.shouldCapture(
                        hostingEnabled = hostingEnabled,
                        inChat = inChat,
                        title = currentTitle,
                        messageCount = messages.size,
                    )
                ) return@launch

                val contactName = currentTitle!!.trim()
                val context = contextStore.getOrCreate(platform, contactName).also {
                    it.contactName = contactName
                }
                enqueueSnapshot(context, messages, manualCapture = true)
            }
            manualChatSyncJobs[slot] = job
            job.invokeOnCompletion {
                synchronized(manualChatSyncJobs) {
                    if (manualChatSyncJobs[slot] === job) {
                        manualChatSyncJobs.remove(slot)
                    }
                }
            }
        }
    }

    private suspend fun inspectStableContentChange(
        platform: String,
        context: ConversationContext
    ) {
        try {
            while (isContentChangeWatchActive(platform, context)) {
                delay(ContentChangeStabilityPolicy.POLL_INTERVAL_MS)
                if (GestureMonitor.isAutomationActionActive()) return
                if (contentChangeStability.shouldKeepWaiting(System.currentTimeMillis())) continue

                val generation = contentChangeStability.generation
                contentChangeStability.resetWindow()
                val adapter = adapterRegistry?.getByPlatform(platform) ?: return
                val root = service?.rootInActiveWindow ?: return
                if (!adapter.isInChat(root) ||
                    !ConversationIdentity.matches(context.contactName, adapter.readChatTitle(root))
                ) return
                val first = IncomingMessageBatch.incomingHistoryFingerprint(adapter.readMessages(root))
                if (first.isBlank()) return
                if (contentChangeStability.generation != generation) continue

                delay(ContentChangeStabilityPolicy.DEFAULT_CONFIRM_DELAY_MS)
                if (!isContentChangeWatchActive(platform, context)) return
                if (contentChangeStability.generation != generation) continue
                val currentRoot = service?.rootInActiveWindow ?: return
                if (!adapter.isInChat(currentRoot) ||
                    !ConversationIdentity.matches(context.contactName, adapter.readChatTitle(currentRoot))
                ) return
                val second = IncomingMessageBatch.incomingHistoryFingerprint(adapter.readMessages(currentRoot))
                if (second.isBlank() || second != first) continue

                val now = System.currentTimeMillis()
                synchronized(context) {
                    if (ReplyDeliveryPolicy.incomingChanged(context.lastIncomingFingerprint, second)) {
                        context.lastIncomingFingerprint = second
                        context.markStableIncomingInvalidation(now)
                        android.util.Log.d("AIA", "stable new incoming message invalidated current LLM reply")
                    }
                }
                wakeSignal.trySend(Unit)
                return
            }
        } finally {
            contentChangeJob = null
        }
    }

    fun onUserInteraction() {
        if (!GestureMonitor.onTouchDetected()) return
        automationOwnedChatKey = null
        staleRetryQueue.clear()
        val activeRoot = service?.rootInActiveWindow
        val adapter = adapterRegistry?.getByPlatform(currentPlatform)
        val manualMessageList = activeRoot != null &&
            adapter != null &&
            activeRoot.packageName?.toString() == adapter.packageName &&
            adapter.isInMessageList(activeRoot)
        if (manualMessageList) {
            nextConversationScanAtMs = 0L
        }
        android.util.Log.d("AIA", "manual takeover detected, state=$state")
        if (state == EngineState.AboutToSend || state == EngineState.Sending || state == EngineState.WaitingLLM) {
            activeContext?.let { context ->
                clearPendingReply(context)
                scope.launch { removeConversationRecovery(context) }
            }
            clearInputField()
        }
        handledConversations.clear()
        state = EngineState.Paused
    }

    suspend fun capturePageSample(): PageSampleResult? {
        val svc = service ?: return null
        val foregroundPackage = svc.windows
            .asSequence()
            .sortedByDescending { window -> window.layer }
            .mapNotNull { window -> window.root?.packageName?.toString() }
            .firstOrNull { packageName ->
                adapterRegistry?.platformForPackage(packageName) != null
            }
        val platform = foregroundPackage
            ?.let { packageName -> adapterRegistry?.platformForPackage(packageName) }
            .orEmpty()
            .ifBlank { currentPlatform.trim() }
        if (platform.isBlank()) return null
        val adapter = adapterRegistry?.getByPlatform(platform) ?: return null
        val appVersion = runCatching {
            svc.packageManager.getPackageInfo(svc.packageName, 0).versionName.orEmpty()
        }.getOrDefault("")
        val result = PageSampler.capture(
            service = svc,
            platform = platform,
            adapter = adapter,
            appVersion = appVersion,
        ) ?: return null
        val token = withContext(Dispatchers.IO) { repository.getActiveToken()?.token?.trim() }
        val apiBase = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
        val uploaded = if (!token.isNullOrBlank() && result.localFile.isNotBlank()) {
            ApiService(apiBase).uploadAutomationIncident(
                token = token,
                incidentFile = File(result.localFile),
                source = "page_sampler",
                kind = "page_sample",
            )
        } else {
            false
        }
        return result.copy(uploaded = uploaded)
    }

    private fun incomingFingerprint(message: PlatformAdapter.ChatMessage): String {
        return IncomingMessageTracker.fingerprint(message.content)
    }

    private fun incomingFingerprint(content: String): String {
        return IncomingMessageTracker.fingerprint(content)
    }


    /**
     * Unknown pages are the one place where the accessibility tree is not
     * enough. Ask the visual model what the screen is, then use only a safe
     * navigation action. This is deliberately throttled so an unstable page
     * cannot burn vision calls in a loop.
     */
    private suspend fun recoverUnknownPageWithVision(
        adapter: PlatformAdapter,
        leaseToken: String,
        force: Boolean = false,
    ): Boolean {
        val now = System.currentTimeMillis()
        if (!force && now - lastVisionPageRecoveryAtMs < VISION_PAGE_RECOVERY_THROTTLE_MS) return false
        lastVisionPageRecoveryAtMs = now

        val svc = service ?: return false
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim().orEmpty()
        }
        if (token.isBlank()) return false
        val image = ScreenCapture.captureJpegBase64(
            service = svc,
            quality = 60,
            maxDimension = 900,
            rejectMostlyBlack = true,
        ) ?: return false
        val api = ApiService(withContext(Dispatchers.IO) { repository.getApiBaseUrl() })
        val vision = api.describeVision(
            token = token,
            imageBase64 = image,
            prompt = VisionPageRecoveryPolicy.PROMPT,
        )
        if (!vision.success || vision.description.isNullOrBlank()) {
            RuntimeJournal.recovery("未知页面视觉恢复失败: ${vision.error ?: "empty"}")
            return false
        }
        val decision = VisionPageRecoveryPolicy.decide(vision.description)
        android.util.Log.d(
            "AIA",
            "vision page recovery decision=$decision detail=${vision.description.take(80)}"
        )
        if (force && decision != VisionPageDecision.MESSAGE_LIST) {
            returnToMessageList(adapter, leaseToken, "vision recovered platform notice")
            return true
        }
        return when (decision) {
            VisionPageDecision.MESSAGE_LIST -> {
                state = EngineState.Idle
                true
            }
            VisionPageDecision.CHAT -> {
                // Let the page settle; the normal chat detector gets another
                // chance on the next loop and will not be forced off-screen.
                delay(700)
                state = EngineState.Idle
                true
            }
            VisionPageDecision.PROFILE,
            VisionPageDecision.COMMERCE,
            VisionPageDecision.NOTICE,
            VisionPageDecision.OTHER -> {
                returnToMessageList(adapter, leaseToken, "vision recovered unknown page")
                true
            }
        }
    }

    private suspend fun returnToMessageList(
        adapter: PlatformAdapter,
        leaseToken: String,
        reason: String
    ) {
        if (!HostingCompletionPolicy.shouldLeaveAfterRead(hostingMode) || !canContinue(leaseToken, null)) return
        val svc = service ?: return
        val currentRoot = svc.rootInActiveWindow ?: return
        val transactionId = AutomationTrace.newTransactionId("return-list")
        AutomationTrace.recordUiAction(
            platform = currentPlatform,
            source = reason,
            action = "return_to_message_list",
            result = "started",
            expectedState = AutomationPageKind.CONVERSATION_LIST.name,
            transactionId = transactionId,
        )
        automationOwnedChatKey = null
        state = EngineState.ScanningConversations
        val currentPage = adapter.observePage(currentRoot).kind
        val needsSafetyBack = ReturnNavigationPolicy.shouldPressBackFirst(
            inChat = adapter.isInChat(currentRoot),
            pageKind = currentPage,
        )
        if (needsSafetyBack) {
            // After a send, the chat tree can be mid-redraw. Always spend one
            // system Back first; this cannot land on an avatar/profile row,
            // unlike a node click, and avoids entering the contact profile.
            svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(650)
        }
        val afterSafetyBack = svc.rootInActiveWindow ?: currentRoot
        val returned = adapter.navigateToMessageList(svc, afterSafetyBack)
        state = EngineState.Idle
        observedState = EngineState.Idle
        observedStateSinceMs = System.currentTimeMillis()
        val observedRoot = svc.rootInActiveWindow
        val observedPage = observedRoot?.let(adapter::observePage)?.kind
            ?: AutomationPageKind.UNKNOWN
        AutomationTrace.recordUiAction(
            platform = currentPlatform,
            source = reason,
            action = "return_to_message_list",
            result = if (returned) "finished" else "failed",
            expectedState = AutomationPageKind.CONVERSATION_LIST.name,
            observedState = observedPage.name,
            transactionId = transactionId,
        )
        if (returned) {
            android.util.Log.d("AIA", "returned to message list reason=$reason")
        } else {
            android.util.Log.w("AIA", "failed to return to message list reason=$reason")
        }
    }

    private fun canContinue(leaseToken: String, interactionEpoch: Long?): Boolean {
        if (!hostingEnabled || !lease.renew(leaseToken)) return false
        return GestureMonitor.canAutomationContinue(interactionEpoch)
    }

    private suspend fun captureIncidentScreenshot(stage: String) {
        val svc = service ?: return
        val screenshot = ScreenCapture.captureJpegBase64(
            service = svc,
            quality = 60,
            maxDimension = 720,
            rejectMostlyBlack = true,
        ) ?: return
        AutomationTrace.attachScreenshot(stage, screenshot)
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

    private sealed class VoiceAudioResult {
        /**
         * 配音已就绪。
         *
         * 带着 PCM 本身（而不是只带字节数），是因为**外放模式要拿它去播放**；
         * 注入模式则由调用方发布到 ContentProvider 交给模块。
         * 什么时候发布、什么时候播放，由 [VoiceOutputMode] 决定。
         */
        data class Ready(val pcm: ByteArray, val durationMs: Long) : VoiceAudioResult()
        data class Failed(val message: String) : VoiceAudioResult()
    }

    /** 把文本合成成配音，解码成规范 PCM 并交给注入通道。 */
    private suspend fun prepareVoiceAudio(
        text: String,
        conversationKey: String
    ): VoiceAudioResult {
        val context = service?.applicationContext
            ?: return VoiceAudioResult.Failed("无障碍服务未启动")
        val token = repository.getActiveToken()?.token?.trim().orEmpty()
        if (token.isEmpty()) return VoiceAudioResult.Failed("请先填设备钥匙")
        val voiceId = repository.getConfig(FISH_VOICE_ID_KEY)?.trim().orEmpty()
            .ifEmpty { DEFAULT_FISH_VOICE_ID }
        val api = ApiService(repository.getApiBaseUrl())

        // 情绪表演层：决定"怎么说"。这一步**只影响语气，不影响说什么** ——
        // 调不通就原样用原话，大不了没有情绪，绝不能因此发不出去。
        val spokenText = runCatching {
            val performance = api.voicePerformance(
                token = token,
                replyText = text,
                previousState = VoiceEmotionMemory.previous(conversationKey)
            )
            VoiceEmotionMemory.remember(conversationKey, performance.state)
            android.util.Log.d(
                "AIA",
                "voice performance planned=${performance.planned} " +
                    "emotion=${performance.dominantEmotion} reason=${performance.reason}"
            )
            performance.taggedText?.trim()?.takeIf { it.isNotEmpty() } ?: text
        }.getOrElse { error ->
            android.util.Log.w("AIA", "voice performance unavailable: ${error.message}")
            text
        }

        val speech = runCatching {
            api.synthesizeSpeech(
                token = token,
                text = spokenText,
                referenceId = voiceId
            )
        }.getOrElse { error ->
            val detail = error.message?.take(80) ?: error::class.java.simpleName
            return VoiceAudioResult.Failed("配音合成失败：$detail")
        }

        val pcm = runCatching {
            val extension = if (speech.contentType?.contains("wav", ignoreCase = true) == true) {
                "wav"
            } else {
                "mp3"
            }
            val temp = File(context.cacheDir, "reply_voice.$extension")
            temp.writeBytes(speech.audio)
            AudioPcmPreparer.toCanonicalPcm(temp)
        }.getOrElse { error ->
            val detail = error.message?.take(80) ?: error::class.java.simpleName
            return VoiceAudioResult.Failed("配音解码失败：$detail")
        }
        if (pcm.isEmpty()) return VoiceAudioResult.Failed("配音解码出来是空的")

        val duration = AudioPcmPreparer.durationMs(pcm.size.toLong())
        if (duration <= 0L) return VoiceAudioResult.Failed("配音时长算不出来")
        if (SoulVoiceRecordPolicy.exceedsSingleRecordLimit(duration)) {
            return VoiceAudioResult.Failed(
                "配音 ${duration / 1000} 秒，一条语音放不下（上限约 59 秒），需要拆句"
            )
        }

        InjectPcmStore.publish(
            context = context,
            pcm = pcm,
            sampleRate = AudioPcmPreparer.CANONICAL_RATE,
            channelCount = AudioPcmPreparer.CANONICAL_CHANNELS
        )
        android.util.Log.d(
            "AIA",
            "voice audio ready bytes=${pcm.size} durationMs=$duration voiceId=${voiceId.take(8)}"
        )
        // 发布是"注入模式"用的；外放模式用不到它，但先发布着不影响
        // （模块取走也没关系 —— 外放模式下录音不会去读它）。
        // 真正决定"发布还是播放"的是 deliverVoiceReply 里的 VoiceOutputMode。
        return VoiceAudioResult.Ready(pcm, duration)
    }

    /**
     * 这台手机该用哪种方式把配音送进录音。
     *
     * 判据是"注入模块还活着吗"（模块每 400ms 来取一次配音）：活着就走注入，
     * 没 root 的手机上根本没这个模块，自然落到外放。配置里也可以手动强制指定。
     */
    private suspend fun resolveVoiceOutput(): VoiceOutput {
        val configured = withContext(Dispatchers.IO) {
            repository.getConfig(VoiceOutputMode.CONFIG_KEY)
        }
        val alive = InjectPcmStore.isModuleAlive()
        val output = VoiceOutputMode.resolve(configured, alive)
        android.util.Log.d(
            "AIA",
            "voice output mode=${output.name.lowercase()} " +
                "configured=${configured ?: VoiceOutputMode.AUTO} moduleAlive=$alive"
        )
        return output
    }

    /**
     * 按输出方式把注入通道准备好。
     *
     * **外放模式下必须把它清干净** —— 否则模块会把上一次发布、还没被取走的配音
     * 灌进这次录音，变成"注入 + 外放"两份声音叠在一起，对方听到的是双重音。
     */
    private fun prepareInjectChannel(output: VoiceOutput) {
        if (output == VoiceOutput.INJECT) return
        val ctx = service?.applicationContext ?: return
        InjectPcmStore.clear(ctx)
    }

    /**
     * 外放要出声，先看音量够不够 —— **只读不调**（用户要求音量由他自己控制）。
     *
     * 音量低到外放必然录出"没声音的语音气泡"时，返回 false：
     * 这种情况**放弃语音、改用文字**。硬发一条哑的比不发还糟（对方点开一片安静，当场穿帮）。
     */
    private fun speakerVolumeIsUsable(): Boolean {
        val percent = VoiceSpeakerPlayback.mediaVolumePercent(
            service?.getSystemService(android.content.Context.AUDIO_SERVICE)
                as? android.media.AudioManager
        )
        android.util.Log.d("AIA", "外放模式：当前媒体音量 ${percent}%（不自动调整）")
        if (!VoiceSpeakerPlayback.isVolumeUsableForSpeaker(percent)) {
            android.util.Log.w("AIA", "外放音量 ${percent}% 太低，改发文字，避免发出没声音的语音")
            RuntimeJournal.recovery(
                "外放音量 ${percent}% 太低（低于 ${VoiceSpeakerPlayback.UNUSABLE_VOLUME_PERCENT}%），" +
                    "改发文字，避免发出没声音的语音"
            )
            return false
        }
        if (VoiceSpeakerPlayback.isVolumeTooLow(percent)) {
            RuntimeJournal.recovery("外放模式：当前媒体音量 ${percent}%（偏低，不自动调整）")
        }
        return true
    }

    /** 读语音回复的两个开关：总开关 + 联系人在不在名单里。 */
    private suspend fun voiceReplySettings(context: ConversationContext): Pair<Boolean, Boolean> {        val (enabled, contacts) = withContext(Dispatchers.IO) {
            repository.getConfig(VoiceReplyPolicy.ENABLED_KEY) to
                repository.getConfig(VoiceReplyPolicy.CONTACTS_KEY)
        }
        return VoiceReplyPolicy.isEnabled(enabled) to
            VoiceReplyPolicy.allowsContact(contacts, context.contactName)
    }

    /**
     * 把这条回复用语音发出去。
     *
     * 顺序是：**先合成配音、发布 PCM，再去开录音** ——
     * 注入模块每 400ms 轮询一次，先发布才能保证录音开始时配音已经就绪。
     *
     * 注意这条路径**不复用文字的"分段投递"**：一条语音就是一个整体，
     * 拆开既啰嗦又假，所以太长时上面就判定 `textFitsOneVoice=false` 了。
     *
     * 返回值：**null 表示"语音这条路没走通"，调用方安全落回文字**；
     * 非 null 时按 `sentParts` 判断 —— >0 就是已经点过发送，绝不能补文字。
     */
    private suspend fun deliverVoiceReply(
        adapter: PlatformAdapter,
        context: ConversationContext,
        outgoing: String,
        replyId: String?,
        leaseToken: String,
        interactionEpoch: Long
    ): ReplyDeliveryResult? {
        val soulAdapter = adapter as? SoulAdapter ?: return null
        val svc = service ?: return null

        val audio = withContext(Dispatchers.IO) {
            // 会话键带上平台和联系人，情绪才是"跟这个人"的一条轨迹。
            prepareVoiceAudio(outgoing, "${context.platform}:${context.contactId}")
        }
        if (audio is VoiceAudioResult.Failed) {
            android.util.Log.w("AIA", "voice reply unavailable: ${audio.message}")
            return null
        }
        val ready = audio as VoiceAudioResult.Ready

        if (!canContinue(leaseToken, interactionEpoch)) {
            return ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, 0, 1)
        }
        val root = awaitSoulChatPage(soulAdapter, SOUL_CHAT_WAIT_MS)
        if (root == null || !soulAdapter.isInChat(root)) {
            // 没停在聊天页就先退回文字，由文字流程负责导航。
            return ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)
        }

        // 这台手机用哪种方式把配音送进录音：root 过的走注入，没 root 的走外放。
        // 判据是"注入模块还活着吗"，另外允许手动强制指定（见 VoiceOutputMode）。
        val output = resolveVoiceOutput()
        prepareInjectChannel(output)
        if (output == VoiceOutput.SPEAKER && !speakerVolumeIsUsable()) {
            // 音量太低，外放只会录出一段没声音的语音 —— 交给文字流程。
            return null
        }

        val result = soulAdapter.recordAndSendVoice(
            audioDurationMs = if (output == VoiceOutput.SPEAKER) {
                // 外放要多留一段：扬声器响起来、声音传到麦克风都需要时间，
                // 不留的话对方听到的开头会缺字。时长核对也用同一个值，
                // 否则会被自己的核对判成"没录够"。
                VoiceOutputMode.speakerRecordDurationMs(ready.durationMs)
            } else {
                ready.durationMs
            },
            spokenText = outgoing,
            canProceed = { canContinue(leaseToken, interactionEpoch) },
            playback = if (output == VoiceOutput.SPEAKER) {
                {
                    // 起协程去放，立刻返回 —— 不能在这里等它放完（见 recordAndSend 的说明）。
                    scope.launch(Dispatchers.IO) {
                        val played = VoiceSpeakerPlayback.play(
                            pcm = ready.pcm,
                            sampleRate = AudioPcmPreparer.CANONICAL_RATE,
                            channelCount = AudioPcmPreparer.CANONICAL_CHANNELS,
                            audioManager = service?.getSystemService(android.content.Context.AUDIO_SERVICE)
                                as? android.media.AudioManager,
                            canProceed = { canContinue(leaseToken, interactionEpoch) }
                        )
                        android.util.Log.d("AIA", "外放播放结束 completed=$played")
                    }
                }
            } else {
                null
            }
        )
        RuntimeJournal.trace(
            TraceEvent(
                traceId = "voice-${context.contactId}-${System.currentTimeMillis()}",
                event = "voice_reply",
                platform = context.platform,
                contactId = context.contactId,
                stage = "sending",
                result = result.status.name.lowercase(),
                reason = result.reason,
            )
        )
        // **不管成功还是失败，都要把输入栏切回文字态。**
        //
        // 真机事故（2026-10-06 20:00）：语音走完（哪怕是失败）输入栏留在语音态，
        // 后面每一次文字回复都找不到文字输入框、全部 TIMEOUT，
        // 每 5 秒重试一次变成死循环，聊天页被一直占着 —— 用户手动点一下开关才停。
        // 语音失败的**原因也一并记下来**：以前这里只在成功时打日志，
        // 失败是静默的，害得我每次都要靠推断。
        if (result.status != SoulVoiceDelivery.Status.SENT) {
            android.util.Log.w(
                "AIA",
                "voice reply not sent status=${result.status.name.lowercase()} reason=${result.reason}"
            )
            RuntimeJournal.recovery(
                "语音发送未完成 status=${result.status.name.lowercase()} reason=${result.reason}"
            )
        }
        val switchedBack = runCatching { soulAdapter.switchInputToTextMode() }
            .onFailure { android.util.Log.w("AIA", "切回文字模式失败: ${it.message}") }
            .getOrDefault(false)
        if (!switchedBack && result.status != SoulVoiceDelivery.Status.SENT) {
            // 切不回文字、又不是成功发出的 —— 多半是录音面板没收干净
            // （cancel 按钮认不出来就不会去点）。用 BACK 兜底把它收掉，
            // 否则输入栏被挡着，后面所有文字回复都会 TIMEOUT 死循环。
            android.util.Log.w("AIA", "录音面板可能没收干净，按 BACK 兜底")
            svc.performGlobalAction(
                android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
            )
        }

        return when (result.status) {
            SoulVoiceDelivery.Status.SENT -> finishSentVoiceReply(context, outgoing, replyId)

            // 点过发送但面板没收起：可能已经发出去了，标记成"已发但未确认"，
            // 调用方看到 sentParts>0 就不会再补一条文字。
            SoulVoiceDelivery.Status.FAILED ->
                if (result.reason == "panel_not_closed_after_send") {
                    ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 1, 1)
                } else {
                    ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)
                }

            SoulVoiceDelivery.Status.CANCELLED ->
                // 没发出去（时长核对没过、主动取消）—— 用 FAILED 表达"这条没成功"，
                // sentParts=0 让调用方安全落回文字。
                ReplyDeliveryResult(ReplyDeliveryStatus.FAILED, 0, 1)
            SoulVoiceDelivery.Status.STOPPED ->
                ReplyDeliveryResult(ReplyDeliveryStatus.STOPPED, 0, 1)
        }
    }

    /**
     * 语音发出去之后的收尾 —— **必须和文字那条路做一样的事**。
     *
     * 这是 2026-10-06 用户反馈"语音回复跟其他功能衔接不上"的根因：
     * 岔路口原来直接 `return ReplyDeliveryResult(COMPLETE, 1, 1)`，
     * 而 `confirmed` 的默认值是 **false**，于是每次语音回复都掉进
     * "reply sent but backend confirmation failed; retry on next scan" 那一支 ——
     * 后台永远收不到"这条回复发出去了"，监控/统计里就一直缺。
     *
     * 文字路径的收尾一共三件事，这里一件都不能少：
     * 1. `rememberAutomatedReply` —— 告诉上下文"这条是我刚发的"，
     *    否则下一轮读聊天页会把它当成**对方发来的新消息**（方向就反了）；
     * 2. `saveConversationRecovery` —— 断电/重启后能接着往下走；
     * 3. `ReplyConfirmationQueue.queueSentReply` —— 把"已发送"回传后端。
     */
    private suspend fun finishSentVoiceReply(
        context: ConversationContext,
        outgoing: String,
        replyId: String?
    ): ReplyDeliveryResult {
        // 上下文里比对的是"聊天页上读到的内容"，语音气泡读出来是 `[语音] 说了什么`，
        // 所以这里用 resolveOutgoing 的结果，而不是光秃秃的回复文字。
        val bubbleContent = SoulVoiceContent.resolveOutgoing(outgoing, "")
        synchronized(context) {
            context.rememberAutomatedReply(bubbleContent)
            context.pendingReplySentParts = 1
            context.pendingReplyTotalParts = 1
            context.pendingReplyParts.clear()
        }
        saveConversationRecovery(context)
        val confirmed = if (replyId.isNullOrBlank()) {
            true
        } else {
            replyConfirmationQueue.queueSentReply(replyId, outgoing)
        }
        // **把这条语音"说了什么"记下来。**
        //
        // 声音发出去之后就查不到内容了：数据库里只有同步过来的 `[语音]`，
        // 而合成用的文字只存在内存（SelfVoiceMemory），重启就没了 ——
        // 结果每次验证都得让人拿耳朵听。用户明确提过这一点。
        //
        // 其实文字是我们自己先写、再合成成声音的，所以**只要记下来就永远能查**。
        // 运行日志进文件（`/data/data/com.aaiagent/files/journal/runtime_journal.txt`），
        // logcat 那行用于实时盯。
        RuntimeJournal.messageSent(
            true,
            "voice reply sent contact=${context.contactName} said=$outgoing"
        )
        android.util.Log.d(
            "AIA",
            "voice reply sent contact=${context.contactName} " +
                "chars=${outgoing.length} said=$outgoing"
        )
        return ReplyDeliveryResult(
            status = ReplyDeliveryStatus.COMPLETE,
            sentParts = 1,
            totalParts = 1,
            confirmed = confirmed
        )
    }

    /** 等 Soul 的聊天页真正出现在前台。 */
    private suspend fun awaitSoulChatPage(
        adapter: SoulAdapter,
        timeoutMs: Long
    ): AccessibilityNodeInfo? {
        val svc = service ?: return null
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() <= deadline) {
            val root = svc.rootInActiveWindow
            if (root != null && adapter.isInChat(root)) return root
            delay(SOUL_CHAT_POLL_MS)
        }
        return null
    }

    private fun queueStaleRetry(
        context: ConversationContext,
        delayMs: Long = STALE_RETRY_DELAY_MS,
    ) {
        staleRetryQueue.enqueue(
            platform = currentPlatform,
            contactId = context.contactId,
            contactName = context.contactName,
            delayMs = delayMs,
            maxAttempts = MAX_STALE_RETRIES,
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
        const val VISION_PAGE_RECOVERY_THROTTLE_MS = 20_000L
        /** 从没聊过的联系人，页面渲染慢，最多等几次重读。 */
        const val STALE_PAGE_REREAD_ATTEMPTS = 3
        /** 发送前聊天页验证最多再审几次（新联系人页面重绘期间会短暂判不出聊天页）。 */
        /** 消息条数不超过这个值就按"短会话"处理：不滚动、不重读，直接回。 */
        const val SHORT_CONVERSATION_MAX_MESSAGES = 5
        const val SEND_PRECHECK_ATTEMPTS = 2
        const val SEND_PRECHECK_DELAY_MS = 700L
        const val STALE_PAGE_REREAD_DELAY_MS = 900L
        const val POLL_INTERVAL_MS = 3_000L
        const val SOUL_SHADOW_PROBE_INTERVAL_MS = 2_000L
        const val NEW_SOUL_ENTRY_TAKEOVER_ENABLED = true
        const val SOUL_ENTRY_MAX_ENTRIES = 12
        const val SOUL_LIST_IDLE_RESCAN_MS = 3_000L
        const val CONTENT_CHANGE_WAKE_INTERVAL_MS = 1_000L
        const val LEASE_HEARTBEAT_INTERVAL_MS = 5_000L
        const val USER_PAUSE_MS = GestureMonitor.USER_PAUSE_MS
        // User browsing only needs to win for a moment. 60s used to stall every
        // scheduled click for a full minute after a single touch.
        const val USER_NAVIGATION_GRACE_MS = 20_000L
        /** 把 Soul 切到前台后，等它的聊天页出现多久。 */
        const val SOUL_CHAT_WAIT_MS = 20_000L
        const val SOUL_CHAT_POLL_MS = 400L

        /** Fish 音色 ID 的配置项。留空就用下面这个默认值。 */
        const val FISH_VOICE_ID_KEY = "fish_voice_id"

        /**
         * 默认音色 —— FishVoice 里锁定的那个（你本人的克隆音色）。
         * 想换音色就改配置项 [FISH_VOICE_ID_KEY]，不用改代码。
         */
        const val DEFAULT_FISH_VOICE_ID = "f05f4be91c194d6482bf2de3bfa5c5a3"
        /** 发送被平台限制后的冷却时间。 */
        const val SEND_BANNED_BLOCK_MS = 60L * 60 * 1000
        const val DEDUP_WINDOW_MS = 5 * 60 * 1000L
        // Measured on device: Soul sometimes needs more than 2.5s before the
        // chat page exposes its input bar. 700ms + 7x450ms ~= 3.9s keeps the
        // "enter, look, leave" skip from dropping a conversation that was
        // merely slow to render.
        const val MAX_CHAT_WAIT_RETRIES = 8
        const val CHAT_VERIFY_INITIAL_DELAY_MS = 700L
        const val CHAT_VERIFY_RETRY_DELAY_MS = 450L
        const val CHAT_PAGE_RECHECK_DELAY_MS = 600L
        const val CHAT_IDENTITY_RETRY_DELAY_MS = 200L
        const val READ_MESSAGE_RETRIES = 6
        const val VISUAL_RETURN_RETRIES = 4
        const val MAX_LLM_RETRIES = 3
        const val STALE_REPLY_COOLDOWN_MS = 1_000L
        const val STALE_RETRY_DELAY_MS = 350L
        const val MAX_STALE_RETRIES = 3
    }
}
