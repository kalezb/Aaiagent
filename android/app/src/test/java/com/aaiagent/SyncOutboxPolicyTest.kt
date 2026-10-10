package com.aaiagent

import com.aaiagent.engine.SyncOutboxPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncOutboxPolicyTest {
    @Test
    fun `a never attempted outbox item is flushed immediately`() {
        assertTrue(SyncOutboxPolicy.shouldAttempt(0L, 1_000L, force = false, minIntervalMs = 10_000L))
    }

    @Test
    fun `forced flush bypasses the interval throttle`() {
        assertTrue(SyncOutboxPolicy.shouldAttempt(9_900L, 10_000L, force = true, minIntervalMs = 10_000L))
    }

    @Test
    fun `background flush waits for the configured interval`() {
        assertFalse(SyncOutboxPolicy.shouldAttempt(9_500L, 10_000L, force = false, minIntervalMs = 10_000L))
        assertTrue(SyncOutboxPolicy.shouldAttempt(0L, 10_000L, force = false, minIntervalMs = 10_000L))
        assertFalse(SyncOutboxPolicy.shouldAttempt(1L, 10_000L, force = false, minIntervalMs = 10_000L))
    }

    @Test
    fun `retry delay backs off and stays capped`() {
        assertEquals(2_000L, SyncOutboxPolicy.retryDelayMs(1))
        assertEquals(4_000L, SyncOutboxPolicy.retryDelayMs(2))
        assertEquals(300_000L, SyncOutboxPolicy.retryDelayMs(20))
    }
}
