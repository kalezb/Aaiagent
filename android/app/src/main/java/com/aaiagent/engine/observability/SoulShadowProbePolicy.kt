package com.aaiagent.engine.observability

object SoulShadowProbePolicy {
    fun shouldProbe(
        hostingEnabled: Boolean,
        platform: String,
        elapsedMs: Long,
        intervalMs: Long,
    ): Boolean {
        if (hostingEnabled) return false
        if (platform != "soul") return false
        return elapsedMs >= intervalMs
    }
}
