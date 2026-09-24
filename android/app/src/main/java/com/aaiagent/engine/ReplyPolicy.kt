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

object ReplyFormatter {
    private val sentenceBoundary = Regex("[。！？!?\\n]+")
    private val punctuation = Regex("[，,。.!！?？；;：:、\"'“”‘’（）()【】\\[\\]]+")

    fun formatForSending(raw: String): List<String> {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return emptyList()

        val rawSegments = trimmed
            .split(sentenceBoundary)
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (rawSegments.size <= 1 || trimmed.length <= 15) {
            return listOf(normalize(trimmed)).filter { it.isNotEmpty() }
        }
        if (rawSegments.size > 5) {
            return listOf(normalize(trimmed)).filter { it.isNotEmpty() }
        }
        return rawSegments.map(::normalize).filter { it.isNotEmpty() }
    }

    fun normalize(text: String): String {
        return punctuation
            .replace(text, " ")
            .replace(Regex("[ \\t]+"), " ")
            .trim()
    }
}
