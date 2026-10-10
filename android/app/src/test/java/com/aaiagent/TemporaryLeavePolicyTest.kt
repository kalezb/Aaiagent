package com.aaiagent

import com.aaiagent.engine.TemporaryLeavePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TemporaryLeavePolicyTest {
    @Test
    fun `semantic exits carry a cooldown with a safe fallback`() {
        assertEquals(
            25 * 60_000L,
            TemporaryLeavePolicy.semanticExitCooldownMs("social_exit", 25 * 60_000L)
        )
        assertEquals(
            15 * 60_000L,
            TemporaryLeavePolicy.semanticExitCooldownMs("social_exit", null)
        )
        assertNull(TemporaryLeavePolicy.semanticExitCooldownMs("xingmu_soul_only", null))
    }
}
