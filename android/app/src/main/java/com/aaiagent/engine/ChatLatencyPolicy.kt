package com.aaiagent.engine

object ChatLatencyPolicy {
    const val SLOW_CLIENT_TOTAL_MS = 10_000L

    fun isSlow(clientTotalMs: Long): Boolean {
        return clientTotalMs >= SLOW_CLIENT_TOTAL_MS
    }
}
