package com.aaiagent.engine

data class ReplyDeliveryProgress(
    val sentParts: Int,
    val totalParts: Int
) {
    val isComplete: Boolean
        get() = totalParts > 0 && sentParts == totalParts

    val isPartial: Boolean
        get() = sentParts in 1 until totalParts

    val remainingParts: List<String>
        get() = emptyList()
}

enum class ReplyDeliveryStatus {
    COMPLETE,
    PARTIAL,
    STALE,
    STOPPED,
    FAILED
}

data class ReplyDeliveryResult(
    val status: ReplyDeliveryStatus,
    val sentParts: Int,
    val totalParts: Int
) {
    val isComplete: Boolean get() = status == ReplyDeliveryStatus.COMPLETE
}

object ReplyDeliveryPolicy {
    fun progress(sentParts: Int, totalParts: Int): ReplyDeliveryProgress {
        return ReplyDeliveryProgress(
            sentParts = sentParts.coerceIn(0, totalParts.coerceAtLeast(0)),
            totalParts = totalParts.coerceAtLeast(0)
        )
    }

    fun remaining(parts: List<String>, sentParts: Int): List<String> {
        if (parts.isEmpty()) return emptyList()
        return parts.drop(sentParts.coerceIn(0, parts.size))
    }

    /**
     * Keeps natural model output unchanged up to four messages. Longer output is
     * compacted into the fourth message instead of forcing a fixed three-part reply.
     */
    fun prepareParts(parts: List<String>, maxParts: Int = 4): List<String> {
        if (parts.isEmpty() || maxParts <= 0) return emptyList()
        val cleaned = parts.map(String::trim).filter(String::isNotEmpty)
        if (cleaned.size <= maxParts) return cleaned
        val head = cleaned.take(maxParts - 1)
        val mergedTail = cleaned.drop(maxParts - 1).joinToString(" ").trim()
        return if (mergedTail.isEmpty()) head else head + mergedTail
    }

    fun incomingChanged(expectedFingerprint: String, currentFingerprint: String): Boolean {
        return expectedFingerprint.isNotBlank() && expectedFingerprint != currentFingerprint
    }
}
