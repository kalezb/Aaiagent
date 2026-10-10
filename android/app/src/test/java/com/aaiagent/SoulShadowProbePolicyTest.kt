package com.aaiagent

import com.aaiagent.engine.observability.SoulShadowProbePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulShadowProbePolicyTest {
    @Test
    fun `shadow probe is disabled while hosting is doing real work`() {
        assertFalse(SoulShadowProbePolicy.shouldProbe(
            hostingEnabled = true,
            platform = "soul",
            elapsedMs = 60_000L,
            intervalMs = 2_000L,
        ))
    }

    @Test
    fun `shadow probe still runs for soul when hosting is off`() {
        assertTrue(SoulShadowProbePolicy.shouldProbe(
            hostingEnabled = false,
            platform = "soul",
            elapsedMs = 2_000L,
            intervalMs = 2_000L,
        ))
    }

    @Test
    fun `shadow probe ignores other platforms`() {
        assertFalse(SoulShadowProbePolicy.shouldProbe(
            hostingEnabled = false,
            platform = "qq",
            elapsedMs = 60_000L,
            intervalMs = 2_000L,
        ))
    }
}
