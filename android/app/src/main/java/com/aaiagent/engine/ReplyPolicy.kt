package com.aaiagent.engine

enum class ReplyFreshnessDecision {
    KEEP,
    RECOMPUTE,
    FORCE_SEND
}

object ReplyFreshnessPolicy {
    fun decide(
        requestId: Int,
        currentRequestId: Int,
        recalcCount: Int,
        firstMessageAtMs: Long,
        nowMs: Long,
        maxRecalc: Int = 3,
        maxWaitMs: Long = 8_000L
    ): ReplyFreshnessDecision {
        if (requestId == currentRequestId) return ReplyFreshnessDecision.KEEP
        val expired = firstMessageAtMs > 0L && nowMs - firstMessageAtMs >= maxWaitMs
        if (recalcCount >= maxRecalc || expired) {
            return ReplyFreshnessDecision.FORCE_SEND
        }
        return ReplyFreshnessDecision.RECOMPUTE
    }
}

object IncomingMessageTracker {
    fun fingerprint(content: String): String = content.trim().replace(Regex("\\s+"), " ")

    fun isNew(previousFingerprint: String, content: String): Boolean {
        val current = fingerprint(content)
        return current.isNotEmpty() && current != previousFingerprint
    }
}
