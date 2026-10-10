package com.aaiagent.engine

/**
 * Coalesces bursts of accessibility content-change events.
 *
 * Gift and full-screen Soul animations can emit content changes continuously.
 * The chat reader is comparatively expensive, so callers should wait for a
 * quiet window and cap that wait when the burst never stops.
 */
class ContentChangeStabilityPolicy(
    private val quietWindowMs: Long = DEFAULT_QUIET_WINDOW_MS,
    private val maxWindowMs: Long = DEFAULT_MAX_WINDOW_MS,
) {
    private var firstEventAtMs: Long = 0L
    private var lastEventAtMs: Long = 0L

    var generation: Long = 0L
        private set

    fun record(nowMs: Long) {
        if (firstEventAtMs == 0L) firstEventAtMs = nowMs
        lastEventAtMs = nowMs
        generation++
    }

    fun shouldKeepWaiting(nowMs: Long): Boolean {
        if (firstEventAtMs == 0L) return false
        val quiet = nowMs - lastEventAtMs < quietWindowMs
        val withinMaxWindow = nowMs - firstEventAtMs < maxWindowMs
        return quiet && withinMaxWindow
    }

    fun resetWindow() {
        firstEventAtMs = 0L
        lastEventAtMs = 0L
    }

    companion object {
        const val DEFAULT_QUIET_WINDOW_MS = 450L
        const val DEFAULT_MAX_WINDOW_MS = 1_800L
        const val DEFAULT_CONFIRM_DELAY_MS = 300L
        const val POLL_INTERVAL_MS = 100L
    }
}
