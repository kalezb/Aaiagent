package com.aaiagent

import com.aaiagent.engine.automation.AutomationRecoveryPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationRecoveryPolicyTest {
    @Test
    fun `recovers an unexpected profile page while hosting`() {
        assertTrue(
            AutomationRecoveryPolicy.shouldRecoverUnexpectedProfile(
                hostingEnabled = true,
                paused = false,
                userTouchingRecently = false,
                lastRecoveryAtMs = 0L,
                nowMs = 10_000L,
            )
        )
    }

    @Test
    fun `does not fight the user or recovery cooldown`() {
        assertFalse(
            AutomationRecoveryPolicy.shouldRecoverUnexpectedProfile(
                hostingEnabled = true,
                paused = false,
                userTouchingRecently = true,
                lastRecoveryAtMs = 0L,
                nowMs = 10_000L,
            )
        )
        assertFalse(
            AutomationRecoveryPolicy.shouldRecoverUnexpectedProfile(
                hostingEnabled = true,
                paused = false,
                userTouchingRecently = false,
                lastRecoveryAtMs = 9_000L,
                nowMs = 10_000L,
            )
        )
    }

    @Test
    fun `refresh storm pause expires normally`() {
        val pausedUntil = AutomationRecoveryPolicy.refreshStormPausedUntil(10_000L)
        assertTrue(
            AutomationRecoveryPolicy.shouldPauseForRefreshStorm(
                pausedUntilMs = pausedUntil,
                nowMs = 11_000L,
            )
        )
        assertFalse(
            AutomationRecoveryPolicy.shouldPauseForRefreshStorm(
                pausedUntilMs = pausedUntil,
                nowMs = pausedUntil,
            )
        )
    }
}
