package com.aaiagent.engine

object SyncOutboxPolicy {
    fun shouldAttempt(
        lastAttemptAtMs: Long,
        nowMs: Long,
        force: Boolean,
        minIntervalMs: Long
    ): Boolean {
        if (force) return true
        if (lastAttemptAtMs <= 0L) return true
        return nowMs - lastAttemptAtMs >= minIntervalMs
    }

    fun retryDelayMs(attempts: Int): Long {
        val retryNumber = attempts.coerceAtLeast(1)
        return minOf(MAX_RETRY_DELAY_MS, INITIAL_RETRY_DELAY_MS shl minOf(retryNumber, MAX_SHIFT))
    }

    private const val INITIAL_RETRY_DELAY_MS = 1_000L
    private const val MAX_RETRY_DELAY_MS = 300_000L
    private const val MAX_SHIFT = 9
}
