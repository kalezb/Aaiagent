package com.aaiagent

import com.aaiagent.engine.ContentChangeStabilityPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentChangeStabilityPolicyTest {
    @Test
    fun `keeps waiting while animation events keep arriving`() {
        val policy = ContentChangeStabilityPolicy(
            quietWindowMs = 450L,
            maxWindowMs = 1_800L,
        )

        policy.record(1_000L)
        assertTrue(policy.shouldKeepWaiting(1_200L))
        policy.record(1_250L)
        assertTrue(policy.shouldKeepWaiting(1_500L))
    }

    @Test
    fun `releases after a quiet window`() {
        val policy = ContentChangeStabilityPolicy(
            quietWindowMs = 450L,
            maxWindowMs = 1_800L,
        )

        policy.record(1_000L)
        assertFalse(policy.shouldKeepWaiting(1_450L))
    }

    @Test
    fun `caps an endless content-change burst`() {
        val policy = ContentChangeStabilityPolicy(
            quietWindowMs = 450L,
            maxWindowMs = 1_800L,
        )

        policy.record(1_000L)
        policy.record(1_300L)
        policy.record(1_600L)

        policy.record(2_700L)

        assertTrue(policy.shouldKeepWaiting(2_799L))
        assertFalse(policy.shouldKeepWaiting(2_800L))
    }

    @Test
    fun `generation advances for every event and survives window reset`() {
        val policy = ContentChangeStabilityPolicy()

        policy.record(100L)
        policy.record(120L)
        assertEquals(2L, policy.generation)

        policy.resetWindow()
        assertFalse(policy.shouldKeepWaiting(200L))
        policy.record(220L)
        assertEquals(3L, policy.generation)
    }
}
