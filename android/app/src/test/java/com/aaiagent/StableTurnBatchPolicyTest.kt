package com.aaiagent

import com.aaiagent.engine.ReplyFreshnessPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StableTurnBatchPolicyTest {
    @Test
    fun `every turn gets a second page read before generation`() {
        assertTrue(ReplyFreshnessPolicy.shouldConfirmStableBatch())
    }

    @Test
    fun `a message that just arrived still waits for the burst window`() {
        // 刚发出来的消息，对方可能还在连着发，必须等一下再回。
        val now = 1_000_000L
        assertFalse(ReplyFreshnessPolicy.hasSettled(now, true, now))
        assertFalse(ReplyFreshnessPolicy.hasSettled(now - 2_000L, true, now))
    }

    @Test
    fun `an older message skips the wait to save two full page reads`() {
        // 2026-11-03 真机计时：这段等待每轮占 2.9~4.9 秒。消息早就放着了就不用等。
        val now = 1_000_000L
        assertTrue(ReplyFreshnessPolicy.hasSettled(now - 10_000L, true, now))
        assertTrue(ReplyFreshnessPolicy.hasSettled(now - 600_000L, true, now))
    }

    @Test
    fun `unknown timestamps never skip the wait`() {
        // 时间读不准就老实等，宁可慢一点，也不要一句话拆两半回。
        val now = 1_000_000L
        assertFalse(ReplyFreshnessPolicy.hasSettled(null, true, now))
        assertFalse(ReplyFreshnessPolicy.hasSettled(now - 60_000L, false, now))
        assertFalse(ReplyFreshnessPolicy.hasSettled(0L, true, now))
    }
}
