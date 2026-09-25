package com.aaiagent.engine

object BackendTaskPollPolicy {
    fun isDue(lastPolledAt: Long, now: Long, intervalMs: Long): Boolean {
        if (lastPolledAt <= 0L) return true
        return now - lastPolledAt >= intervalMs
    }
}
