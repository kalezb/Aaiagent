package com.aaiagent

import com.aaiagent.engine.AutomationLease
import com.aaiagent.engine.BackendTaskPollPolicy
import com.aaiagent.adapter.PlatformAdapter.VoiceTranscriptionResult
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.IncomingMessageTracker
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
    fun `semi auto stays in chat while full auto and monitor only leave after a read`() {
        assertFalse(
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
        assertTrue(HostingCompletionPolicy.shouldLeaveAfterRead(HostingMode.MONITOR_ONLY))
        assertFalse(HostingCompletionPolicy.shouldLeaveAfterRead(HostingMode.SEMI_AUTO))
    }

    @Test
    fun `lease only belongs to the latest owner`() {
        var now = 1_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "token-${now}" })

        val first = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(first))

        now += 100L
        val second = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(second))
        assertFalse(lease.owns(first))

        now += 501L
        assertFalse(lease.owns(second))
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
    }

    @Test
    fun `lease heartbeats keep a long model and media step alive`() {
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
    fun `conversation identity accepts safe title variations`() {
        assertTrue(ConversationIdentity.matches("星暮", "星暮"))
        assertTrue(ConversationIdentity.matches("小明同学", "小明同学 在线"))
        assertFalse(ConversationIdentity.matches("小明", "小明明"))
        assertFalse(ConversationIdentity.matches("unknown", "小明"))
        assertFalse(ConversationIdentity.matches("", "小明"))
    }

    @Test
    fun `reply freshness forces send after deadline`() {
        assertEquals(
            ReplyFreshnessDecision.KEEP,
            ReplyFreshnessPolicy.decide(2, 2, 0, 1_000L, 2_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.RECOMPUTE,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 2_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.FORCE_SEND,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 10_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.FORCE_SEND,
            ReplyFreshnessPolicy.decide(2, 3, 3, 1_000L, 2_000L)
        )
    }


    @Test
    fun `sync message keys are stable for a persisted sequence`() {
        val first = SyncMessageKey.build("soul", "contact-1", "user", "hello", 0)
        assertEquals(first, SyncMessageKey.build("soul", "contact-1", "user", "hello", 0))
        assertTrue(first.startsWith("sync:soul:contact-1:"))
        assertFalse(first == SyncMessageKey.build("soul", "contact-1", "user", "hello", 1))
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

        assertEquals(listOf(2, 3), SyncSnapshotPolicy.selectNewItems(previous, current))
        assertEquals(emptyList<Int>(), SyncSnapshotPolicy.selectNewItems(previous, previous))
    }

    @Test
    fun `snapshot codec round trips repeated messages`() {
        val snapshot = listOf(
            SyncSnapshotItem("user", "hello", createdAt = 100),
            SyncSnapshotItem("user", "hello", createdAt = 200)
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
}
