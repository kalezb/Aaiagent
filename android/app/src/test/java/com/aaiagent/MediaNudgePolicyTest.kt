package com.aaiagent

import com.aaiagent.engine.MediaNudgeDecision
import com.aaiagent.engine.MediaNudgePolicy
import com.aaiagent.engine.MediaNudgeState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaNudgePolicyTest {
    @Test
    fun `first sticker gets a fixed reply without vision`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = "sticker",
            visibleFingerprint = "event-1",
            state = MediaNudgeState(),
            nowMs = 1_000L
        )

        assertEquals(MediaNudgeDecision.FIXED_REPLY, result.decision)
        assertEquals(1, result.nextState.consecutiveCount)
        assertEquals("打字聊吧 我有点反感表情包", result.reply)
    }

    @Test
    fun `second sticker gets one more fixed reminder`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = "sticker",
            visibleFingerprint = "event-2",
            state = MediaNudgeState(consecutiveCount = 1, lastEventAtMs = 1_000L),
            nowMs = 2_000L
        )

        assertEquals(MediaNudgeDecision.FIXED_REPLY, result.decision)
        assertEquals(2, result.nextState.consecutiveCount)
        assertEquals("别发表情包啦 打字跟我说", result.reply)
    }

    @Test
    fun `third sticker stops automated replies`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = "sticker",
            visibleFingerprint = "event-3",
            state = MediaNudgeState(consecutiveCount = 2, lastEventAtMs = 2_000L),
            nowMs = 3_000L
        )

        assertEquals(MediaNudgeDecision.STOP, result.decision)
        assertEquals(3, result.nextState.consecutiveCount)
        assertNull(result.reply)
    }

    @Test
    fun `voice uses voice specific reminder`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = "voice",
            visibleFingerprint = "voice-1",
            state = MediaNudgeState(),
            nowMs = 1_000L
        )

        assertEquals(MediaNudgeDecision.FIXED_REPLY, result.decision)
        assertEquals("打字聊吧 语音不太方便听", result.reply)
    }

    @Test
    fun `a text message resets consecutive media count`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = null,
            visibleFingerprint = "text-1",
            state = MediaNudgeState(consecutiveCount = 3, lastEventAtMs = 3_000L),
            nowMs = 4_000L
        )

        assertEquals(MediaNudgeDecision.NORMAL, result.decision)
        assertEquals(0, result.nextState.consecutiveCount)
        assertEquals(0L, result.nextState.lastEventAtMs)
    }

    @Test
    fun `same handled event is skipped during cooldown`() {
        val handled = MediaNudgePolicy.markHandled(
            state = MediaNudgeState(consecutiveCount = 1, lastEventAtMs = 1_000L),
            visibleFingerprint = "same-event",
            nowMs = 2_000L
        )
        val result = MediaNudgePolicy.evaluate(
            mediaType = "sticker",
            visibleFingerprint = "same-event",
            state = handled,
            nowMs = 2_000L + MediaNudgePolicy.HANDLED_COOLDOWN_MS - 1
        )

        assertEquals(MediaNudgeDecision.DUPLICATE, result.decision)
    }

    @Test
    fun `different visible event gets handled after previous reply`() {
        val first = MediaNudgePolicy.markHandled(
            state = MediaNudgeState(consecutiveCount = 1, lastEventAtMs = 1_000L),
            visibleFingerprint = "first",
            nowMs = 2_000L
        )
        val result = MediaNudgePolicy.evaluate(
            mediaType = "interaction",
            visibleFingerprint = "second",
            state = first,
            nowMs = 3_000L
        )

        assertEquals(MediaNudgeDecision.FIXED_REPLY, result.decision)
        assertEquals(2, result.nextState.consecutiveCount)
        assertTrue(result.reply!!.contains("别拍"))
    }

    @Test
    fun `old media events do not count forever`() {
        val result = MediaNudgePolicy.evaluate(
            mediaType = "sticker",
            visibleFingerprint = "new-day",
            state = MediaNudgeState(consecutiveCount = 2, lastEventAtMs = 1_000L),
            nowMs = 1_000L + MediaNudgePolicy.EVENT_WINDOW_MS + 1
        )

        assertEquals(MediaNudgeDecision.FIXED_REPLY, result.decision)
        assertEquals(1, result.nextState.consecutiveCount)
    }
}
