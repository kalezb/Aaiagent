package com.aaiagent

import com.aaiagent.engine.HostingReplyAction
import com.aaiagent.engine.AutomationLease
import com.aaiagent.engine.BackendTaskPollPolicy
import com.aaiagent.engine.GestureMonitor
import com.aaiagent.adapter.PlatformAdapter.VoiceTranscriptionResult
import com.aaiagent.engine.ConversationContext
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.IncomingMessageTracker
import com.aaiagent.engine.InitialMergeDecision
import com.aaiagent.engine.MessageEngine
import com.aaiagent.engine.HostingCompletionPolicy
import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.ReplyFreshnessDecision
import com.aaiagent.engine.ReplyFreshnessPolicy
import com.aaiagent.engine.ReplyTaskAction
import com.aaiagent.engine.ReplyTaskPolicy
import com.aaiagent.engine.SyncMessageKey
import com.aaiagent.engine.SyncSnapshotCodec
import com.aaiagent.engine.SyncSnapshotItem
import com.aaiagent.engine.SyncSnapshotPolicy
import com.aaiagent.engine.UserInteractionGate
import com.aaiagent.engine.withAutomationLeaseHeartbeat
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicLong

class MessageEngineTest {
    @Test
    fun `full auto returns to message list only after automation still owns control`() {
        assertTrue(
            HostingCompletionPolicy.shouldReturnToMessageList(
                mode = HostingMode.FULL_AUTO,
                sentAny = true,
                automationStillOwned = true
            )
        )
        assertFalse(
            HostingCompletionPolicy.shouldReturnToMessageList(
                mode = HostingMode.FULL_AUTO,
                sentAny = true,
                automationStillOwned = false
            )
        )
    }

    @Test
    fun `every mode except monitor only leaves the chat and monitor only never acts`() {
        // Semi-auto fills the input box and still has to give the screen back,
        // otherwise the engine waited in the same conversation forever.
        assertTrue(
            HostingCompletionPolicy.shouldReturnToMessageList(
                mode = HostingMode.SEMI_AUTO,
                sentAny = true,
                automationStillOwned = true
            )
        )
        assertFalse(
            HostingCompletionPolicy.shouldReturnToMessageList(
                mode = HostingMode.MONITOR_ONLY,
                sentAny = true,
                automationStillOwned = true
            )
        )
        assertTrue(HostingCompletionPolicy.shouldLeaveAfterRead(HostingMode.FULL_AUTO))
        assertFalse(HostingCompletionPolicy.shouldLeaveAfterRead(HostingMode.MONITOR_ONLY))
        assertTrue(HostingCompletionPolicy.shouldLeaveAfterRead(HostingMode.SEMI_AUTO))
        assertTrue(HostingCompletionPolicy.canPerformScreenActions(HostingMode.FULL_AUTO))
        assertTrue(HostingCompletionPolicy.canPerformScreenActions(HostingMode.SEMI_AUTO))
        assertFalse(HostingCompletionPolicy.canPerformScreenActions(HostingMode.MONITOR_ONLY))
    }

    @Test
    fun `lease only belongs to the latest owner`() {
        var now = 1_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "token-${now}" })

        val first = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(first))
        assertEquals(AutomationLease.Status.ACTIVE, lease.status(first))

        now += 100L
        val second = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(second))
        assertFalse(lease.owns(first))
        assertEquals(AutomationLease.Status.REPLACED, lease.status(first))

        now += 501L
        assertFalse(lease.owns(second))
        assertEquals(AutomationLease.Status.EXPIRED, lease.status(second))
    }

    @Test
    fun `lease can renew and revoke`() {
        var now = 10_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "lease" })
        val token = lease.acquire(ttlMs = 500L)

        now += 400L
        assertTrue(lease.renew(token, ttlMs = 500L))
        now += 400L
        assertTrue(lease.owns(token))

        lease.revoke()
        assertFalse(lease.owns(token))
        assertEquals(AutomationLease.Status.REVOKED, lease.status(token))
    }

    @Test
    fun `lease heartbeats keep a long model and media step alive`() {
        assertTrue(MessageEngine.LEASE_HEARTBEAT_INTERVAL_MS < AutomationLease.DEFAULT_TTL_MS)
        var now = 20_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "long-step" })
        val token = lease.acquire(ttlMs = 30_000L)

        now += 25_000L
        assertTrue(lease.renew(token, ttlMs = 30_000L))
        now += 25_000L
        assertTrue(lease.renew(token, ttlMs = 30_000L))
        now += 20_000L
        assertTrue(lease.owns(token))
    }

    @Test
    fun `lease heartbeat keeps a long list scan alive`() = runBlocking {
        val now = AtomicLong(0L)
        val lease = AutomationLease(
            clock = { now.get() },
            tokenFactory = { "long-scan" },
        )
        val token = lease.acquire(ttlMs = 60L)

        withAutomationLeaseHeartbeat(
            lease = lease,
            leaseToken = token,
            isEnabled = { true },
            intervalMs = 10L,
        ) {
            repeat(8) {
                delay(10L)
                now.addAndGet(10L)
            }
        }

        assertTrue(lease.owns(token))
    }

    @Test
    fun `lease heartbeat survives a blocking main-thread step`() = runBlocking {
        val lease = AutomationLease(
            clock = { System.currentTimeMillis() },
            tokenFactory = { "blocking-scan" },
        )
        val token = lease.acquire(ttlMs = 120L)

        withAutomationLeaseHeartbeat(
            lease = lease,
            leaseToken = token,
            isEnabled = { true },
            intervalMs = 20L,
        ) {
            Thread.sleep(300L)
        }

        assertTrue(lease.owns(token))
    }

    @Test
    fun `voice transcription only replies from model when every voice is readable`() {
        val complete = VoiceTranscriptionResult(total = 3, transcribed = 3)
        assertTrue(complete.hasAny)
        assertTrue(complete.isComplete)
        assertFalse(complete.isPartial)

        val partial = VoiceTranscriptionResult(total = 3, transcribed = 2)
        assertTrue(partial.hasAny)
        assertFalse(partial.isComplete)
        assertTrue(partial.isPartial)

        val none = VoiceTranscriptionResult(total = 3)
        assertFalse(none.hasAny)
        assertFalse(none.isComplete)
        assertFalse(none.isPartial)
    }

    @Test
    fun `automation events do not count as manual takeover`() {
        var now = 5_000L
        val gate = UserInteractionGate(clock = { now })

        gate.onAutomationActionStarted(protectionMs = 1_000L)
        assertFalse(gate.onAccessibilityInteraction())

        now += 1_001L
        assertTrue(gate.onAccessibilityInteraction())
        assertTrue(gate.shouldPause(windowMs = 5_000L))

        now += 5_001L
        assertFalse(gate.shouldPause(windowMs = 5_000L))
    }

    @Test
    fun `manual takeover increments interaction epoch once`() {
        var now = 1_000L
        val gate = UserInteractionGate(clock = { now })

        assertEquals(0L, gate.interactionEpoch())
        assertTrue(gate.onAccessibilityInteraction())
        assertEquals(1L, gate.interactionEpoch())

        gate.onAutomationActionStarted(protectionMs = 500L)
        assertFalse(gate.onAccessibilityInteraction())
        assertEquals(1L, gate.interactionEpoch())
    }

    @Test
    fun `trusted manual touch pauses automation even during automation protection`() {
        var now = 1_000L
        val gate = UserInteractionGate(clock = { now })

        gate.onAutomationActionStarted(protectionMs = 1_000L)
        gate.onManualInteraction()

        assertEquals(1L, gate.interactionEpoch())
        assertTrue(gate.shouldPause())

        now += 5_001L
        assertFalse(gate.shouldPause())
    }

    @Test
    fun `conversation identity accepts safe title variations`() {
        assertTrue(ConversationIdentity.matches("星暮", "星暮"))
        assertTrue(ConversationIdentity.matches("小明同学", "小明同学 在线"))
        assertFalse(ConversationIdentity.matches("小明", "小明明"))
        assertFalse(ConversationIdentity.matches("unknown", "小明"))
        assertFalse(ConversationIdentity.matches("", "小明"))
    }

    @Test
    fun `stale reply is aborted instead of sending old content`() {
        assertEquals(
            ReplyFreshnessDecision.KEEP,
            ReplyFreshnessPolicy.decide(2, 2, 0, 1_000L, 2_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.RECOMPUTE,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 2_000L)
        )
        // 2026-10-05：窗口从 8 秒放宽到 20 秒——实测模型一轮要 5~7 秒，
        // 8 秒会把正常回复判成过期，用户看到的是“不回消息还退出”。
        assertEquals(
            ReplyFreshnessDecision.RECOMPUTE,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 10_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.ABORT_STALE,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 25_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.ABORT_STALE,
            ReplyFreshnessPolicy.decide(2, 3, 3, 1_000L, 2_000L)
        )
        assertTrue(
            ReplyFreshnessPolicy.shouldQueueRetryAfterAbort(ReplyFreshnessDecision.ABORT_STALE)
        )
        assertFalse(
            ReplyFreshnessPolicy.shouldQueueRetryAfterAbort(ReplyFreshnessDecision.RECOMPUTE)
        )
    }

    @Test
    fun `initial merge waits after each new message`() {
        assertEquals(
            InitialMergeDecision.WAIT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 1_300L,
                nowMs = 2_000L
            )
        )
        assertEquals(
            InitialMergeDecision.READY,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 1_300L,
                nowMs = 2_200L
            )
        )
    }

    @Test
    fun `a message burst uses a longer quiet window without slowing a single message`() {
        assertEquals(
            InitialMergeDecision.READY,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 1_000L,
                nowMs = 2_000L,
                burstCount = 1,
            )
        )
        assertEquals(
            InitialMergeDecision.WAIT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 2_000L,
                nowMs = 3_000L,
                burstCount = 2,
            )
        )
        assertEquals(
            InitialMergeDecision.READY,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 2_000L,
                nowMs = 4_500L,
                burstCount = 2,
            )
        )
    }

    @Test
    fun `a burst still has a bounded maximum wait`() {
        assertEquals(
            InitialMergeDecision.WAIT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 10_500L,
                nowMs = 10_999L,
                burstCount = 3,
            )
        )
        assertEquals(
            InitialMergeDecision.TIMEOUT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 10_500L,
                nowMs = 11_000L,
                burstCount = 3,
            )
        )
    }

    @Test
    fun `initial merge sends at the total wait cap even while messages continue`() {
        assertEquals(
            InitialMergeDecision.WAIT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 5_900L,
                nowMs = 5_999L
            )
        )
        assertEquals(
            InitialMergeDecision.TIMEOUT,
            ReplyFreshnessPolicy.initialMergeDecision(
                startedAtMs = 1_000L,
                lastChangeAtMs = 5_900L,
                nowMs = 6_000L
            )
        )
    }

    @Test
    fun `stable incoming message restarts the current reply window`() {
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-1",
            firstMessageAt = 1_000L,
            llmRequestId = 2,
            recalcCount = 2,
        )

        context.markStableIncomingInvalidation(nowMs = 9_000L)

        assertEquals(9_000L, context.firstMessageAt)
        assertEquals(3, context.llmRequestId)
        assertEquals(2, context.recalcCount)
        assertTrue(context.pendingReplyStale)
        assertEquals(
            ReplyFreshnessDecision.RECOMPUTE,
            ReplyFreshnessPolicy.decide(
                requestId = 2,
                currentRequestId = context.llmRequestId,
                recalcCount = context.recalcCount,
                firstMessageAtMs = context.firstMessageAt,
                nowMs = 10_000L,
            )
        )
    }

    @Test
    fun `recomputed reply is accepted only after it matches the current request`() {
        assertTrue(ReplyFreshnessPolicy.canAcceptRecomputedReply(7, 7))
        assertFalse(ReplyFreshnessPolicy.canAcceptRecomputedReply(7, 8))
        assertTrue(ReplyFreshnessPolicy.INITIAL_MERGE_DELAY_MS in 700L..1_200L)
    }

    @Test
    fun `chat verification window tolerates a slow Soul render`() {
        // Regression: 700ms + 4x450ms (~2.5s) dropped a conversation whose chat
        // page needed a moment longer to expose its input bar.
        val windowMs = MessageEngine.CHAT_VERIFY_INITIAL_DELAY_MS +
            (MessageEngine.MAX_CHAT_WAIT_RETRIES - 1L) * MessageEngine.CHAT_VERIFY_RETRY_DELAY_MS
        assertTrue(windowMs in 3_500L..5_000L)
    }

    @Test
    fun `user browsing only blocks scheduling for a short window`() {
        // Regression: a single touch blocked every scheduled click for 60s.
        assertTrue(MessageEngine.USER_NAVIGATION_GRACE_MS in 5_000L..30_000L)
        assertTrue(MessageEngine.USER_PAUSE_MS <= MessageEngine.USER_NAVIGATION_GRACE_MS)
        assertEquals(GestureMonitor.USER_PAUSE_MS, MessageEngine.USER_PAUSE_MS)
    }


    @Test
    fun `sync message keys stay stable when the sequence moves on`() {
        val first = SyncMessageKey.build("soul", "contact-1", "user", "hello", 0)
        assertEquals(first, SyncMessageKey.build("soul", "contact-1", "user", "hello", 0))
        assertTrue(first.startsWith("sync:soul:contact-1:"))
        // 2026-10-06 稀奇：序号每次同步都会前进，不能让它把同一条消息变成新的 key（会造成历史重复）。
        assertEquals(first, SyncMessageKey.build("soul", "contact-1", "user", "hello", 1))
        assertEquals(
            SyncMessageKey.build("soul", "contact-1", "user", "hello", 0, 1_700_000_000L),
            SyncMessageKey.build("soul", "contact-1", "user", "hello", 8, 1_700_000_000L),
        )
        assertFalse(
            SyncMessageKey.build(
                "soul", "contact-1", "user", "hello", 0, 1_700_000_000L, "message-a"
            ) == SyncMessageKey.build(
                "soul", "contact-1", "user", "hello", 0, 1_700_000_000L, "message-b"
            )
        )
        // 2026-10-07 不期而遇 / 卡卡罗特：整段对话被重新入库了一遍 —— 00:16~00:22 的
        // 6 条消息在 00:51:30 这一秒里全部又出现一次，每条都拿到新 key，模型于是以为
        // 话题在原地打转、回复开始重复追问。
        // 漂移的是 createdAt：它由页面上的**相对**时间标签（“刚刚”“5分钟前”）解析而来，
        // 隔一段时间重读同一句话会算出不同的绝对时间。
        // 所以时间锚点变了也必须拿到同一个 key —— 这条断言以前是反的，是基于
        // “解析出的时间对同一条消息稳定”这个假设，真机证明假设不成立。
        assertEquals(
            SyncMessageKey.build("soul", "contact-1", "user", "hello", 0, 1_700_000_000L),
            SyncMessageKey.build("soul", "contact-1", "user", "hello", 0, 1_700_000_001L),
        )
    }

    @Test
    fun `snapshot only selects messages appended after the previous visible window`() {
        val previous = listOf(
            SyncSnapshotItem("user", "hello"),
            SyncSnapshotItem("assistant", "hi")
        )
        val current = previous + listOf(
            SyncSnapshotItem("user", "hello"),
            SyncSnapshotItem("assistant", "still there")
        )

        assertEquals(listOf(2, 3), SyncSnapshotPolicy.selectNewItems(previous, current, true))
        assertEquals(emptyList<Int>(), SyncSnapshotPolicy.selectNewItems(previous, previous, true))
    }

    @Test
    fun `first snapshot establishes a baseline without reuploading visible history`() {
        val visibleHistory = listOf(
            SyncSnapshotItem("assistant", "old one"),
            SyncSnapshotItem("user", "old two")
        )

        assertEquals(
            emptyList<Int>(),
            SyncSnapshotPolicy.selectNewItems(emptyList(), visibleHistory, false)
        )
    }

    @Test
    fun `unmatched visible window does not reupload every message`() {
        val previous = listOf(SyncSnapshotItem("user", "first screen"))
        val current = listOf(SyncSnapshotItem("user", "another screen"))

        assertEquals(
            emptyList<Int>(),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot timestamp fallback keeps new items when the visible window does not overlap`() {
        val previous = listOf(
            SyncSnapshotItem("user", "old screen", createdAt = 100)
        )
        val current = listOf(
            SyncSnapshotItem("user", "older unseen", createdAt = 90),
            SyncSnapshotItem("user", "new message", createdAt = 110)
        )

        assertEquals(
            listOf(1),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot stable key fallback keeps unseen messages without timestamps`() {
        val previous = listOf(
            SyncSnapshotItem("user", "same text", stableKey = "message-a")
        )
        val current = listOf(
            SyncSnapshotItem("user", "same text", stableKey = "message-b"),
            SyncSnapshotItem("user", "same text", stableKey = "message-c")
        )

        assertEquals(
            listOf(0, 1),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot accepts legacy items when stable keys are introduced`() {
        val previous = listOf(
            SyncSnapshotItem("user", "hello", createdAt = 100)
        )
        val current = listOf(
            SyncSnapshotItem("user", "hello", createdAt = 100, stableKey = "message-a")
        )

        assertEquals(
            emptyList<Int>(),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot requeues a voice when transcript appears later`() {
        val voiceKey = "soul\u001fother\u001fvoice\u001f[语音]"
        val previous = listOf(
            SyncSnapshotItem("user", "[语音]", stableKey = voiceKey)
        )
        val current = listOf(
            SyncSnapshotItem(
                "user",
                "对方语音转文字：你睡了吗",
                stableKey = voiceKey,
                transcript = "你睡了吗",
                voiceSeconds = 2,
            )
        )

        assertEquals(
            listOf(0),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot timestamp fallback does not reselect an item from a broken window`() {
        val previous = listOf(
            SyncSnapshotItem("user", "known", createdAt = 110)
        )
        val current = listOf(
            SyncSnapshotItem("assistant", "new", createdAt = 110),
            SyncSnapshotItem("user", "known", createdAt = 110)
        )

        assertEquals(
            listOf(0),
            SyncSnapshotPolicy.selectNewItems(previous, current, true)
        )
    }

    @Test
    fun `snapshot overlap uses stable keys for repeated identical content`() {
        val first = SyncSnapshotItem("user", "hello", stableKey = "message-a")
        val second = SyncSnapshotItem("user", "hello", stableKey = "message-b")

        assertEquals(
            listOf(1),
            SyncSnapshotPolicy.selectNewItems(
                previous = listOf(first),
                current = listOf(first, second),
                hasEstablishedBaseline = true
            )
        )
    }

    @Test
    fun `snapshot codec round trips repeated messages`() {
        val snapshot = listOf(
            SyncSnapshotItem("user", "hello", createdAt = 100),
            SyncSnapshotItem("user", "hello", createdAt = 200, stableKey = "message-b")
        )

        assertEquals(snapshot, SyncSnapshotCodec.decode(SyncSnapshotCodec.encode(snapshot)))
    }

    @Test
    fun `backend task polling is throttled without slowing soul list scans`() {
        assertTrue(BackendTaskPollPolicy.isDue(0L, 1_000L, 30_000L))
        assertFalse(BackendTaskPollPolicy.isDue(1_000L, 30_999L, 30_000L))
        assertTrue(BackendTaskPollPolicy.isDue(1_000L, 31_000L, 30_000L))
    }

    @Test
    fun `backend task policy sends manual text exactly and prioritizes contacts for ai reply`() {
        assertEquals(
            ReplyTaskAction.SEND_EXACT,
            ReplyTaskPolicy.decide("manual", "soul", "soul")
        )
        assertEquals(
            ReplyTaskAction.PROCESS_AI,
            ReplyTaskPolicy.decide("priority_contact", "soul", "soul")
        )
        assertEquals(
            ReplyTaskAction.IGNORE,
            ReplyTaskPolicy.decide("manual", "qq", "soul")
        )
    }

    @Test
    fun `hosting modes separate send fill-input and observe actions`() {
        assertEquals(
            HostingReplyAction.SEND,
            HostingCompletionPolicy.replyAction(HostingMode.FULL_AUTO)
        )
        assertEquals(
            HostingReplyAction.FILL_INPUT_ONLY,
            HostingCompletionPolicy.replyAction(HostingMode.SEMI_AUTO)
        )
        assertEquals(
            HostingReplyAction.OBSERVE_ONLY,
            HostingCompletionPolicy.replyAction(HostingMode.MONITOR_ONLY)
        )
    }

    @Test
    fun `automation only owns a chat it opened itself`() {
        assertTrue(HostingCompletionPolicy.ownsAutomatedChat("soul:alice", "soul:alice"))
        assertFalse(HostingCompletionPolicy.ownsAutomatedChat(null, "soul:alice"))
        assertFalse(HostingCompletionPolicy.ownsAutomatedChat("soul:alice", "soul:bob"))
    }
}
