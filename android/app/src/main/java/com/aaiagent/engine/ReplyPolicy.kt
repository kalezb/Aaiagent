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

    private val explicitSeparator = Regex("\\|{2,}|\\n+")
    private val commaBoundary = Regex("[，,、]+")
    private val pauseBoundary = Regex("[ \\t]+")
    private const val MAX_SENTENCE_SEGMENTS = 5

    fun formatForSending(raw: String): List<String> {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return emptyList()

        val explicitSegments = trimmed
            .split(explicitSeparator)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (explicitSegments.size > 1) {
            return explicitSegments
                .flatMap(::splitLongSegment)
                .map(::normalize)
                .filter { it.isNotEmpty() }
        }

        val sentenceSegments = trimmed
            .split(sentenceBoundary)
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (trimmed.length <= 15 || sentenceSegments.size <= 1) {
            return splitLongSegment(trimmed)
                .map(::normalize)
                .filter { it.isNotEmpty() }
        }
        if (sentenceSegments.size > MAX_SENTENCE_SEGMENTS) {
            return listOf(normalize(trimmed)).filter { it.isNotEmpty() }
        }
        return sentenceSegments
            .flatMap(::splitLongSegment)
            .map(::normalize)
            .filter { it.isNotEmpty() }
    }

    private fun splitLongSegment(segment: String): List<String> {
        val trimmed = segment.trim()
        val commaParts = trimmed.split(commaBoundary)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (commaParts.size > 1) return commaParts

        val pauseParts = trimmed.split(pauseBoundary)
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (pauseParts.size in 2..4) return pauseParts

        return listOf(trimmed)
    }

    fun normalize(text: String): String {
        return punctuation
            .replace(text, " ")
            .replace(Regex("[ \\t]+"), " ")
            .trim()
    }
}

object IncomingMessageTracker {
    fun fingerprint(content: String): String = content.trim().replace(Regex("\\s+"), " ")

    fun isNew(previousFingerprint: String, content: String): Boolean {
        val current = fingerprint(content)
        return current.isNotEmpty() && current != previousFingerprint
    }
}
