package com.aaiagent.engine.automation

object AutomationRecoveryPolicy {
    const val PROFILE_RECOVERY_COOLDOWN_MS = 3_000L
    const val REFRESH_STORM_PAUSE_MS = 3_000L

    fun shouldRecoverUnexpectedProfile(
        hostingEnabled: Boolean,
        paused: Boolean,
        userTouchingRecently: Boolean,
        lastRecoveryAtMs: Long,
        nowMs: Long,
    ): Boolean {
        if (!hostingEnabled || paused || userTouchingRecently) return false
        return lastRecoveryAtMs <= 0L || nowMs - lastRecoveryAtMs >= PROFILE_RECOVERY_COOLDOWN_MS
    }

    fun shouldPauseForRefreshStorm(
        pausedUntilMs: Long,
        nowMs: Long,
    ): Boolean = pausedUntilMs > nowMs

    fun refreshStormPausedUntil(nowMs: Long): Long =
        nowMs + REFRESH_STORM_PAUSE_MS
}
