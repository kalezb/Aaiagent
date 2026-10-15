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
    val totalParts: Int,
    val confirmed: Boolean = false
) {
    val isComplete: Boolean get() = status == ReplyDeliveryStatus.COMPLETE
}

object ReplyDeliveryPolicy {
    @Suppress("UNUSED_PARAMETER")
    fun planParts(
        parts: List<String>,
        randomUnit: Double = kotlin.random.Random.nextDouble()
    ): List<String> {
        val cleaned = parts.map(::cleanPart).filter(String::isNotEmpty)
        if (cleaned.isEmpty()) return emptyList()
        // The model already decides where a message ends (|||). The phone must
        // never split inside a part or glue parts back together.
        return prepareParts(cleaned, maxParts = 3)
    }

    fun delayAfterPart(part: String, randomUnit: Double = kotlin.random.Random.nextDouble()): Long {
        val normalized = randomUnit.coerceIn(0.0, 1.0)
        return if (part.length >= 16) {
            700L + (normalized * 400L).toLong()
        } else {
            350L + (normalized * 300L).toLong()
        }
    }

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

    fun expandLongReply(parts: List<String>, maxParts: Int = 3): List<String> {
        val cleaned = parts.map(::cleanPart).filter(String::isNotEmpty)
        return prepareParts(cleaned, maxParts)
    }

    private fun cleanPart(value: String): String {
        return value.trim()
    }

    /** Keeps the model's own boundaries. Extra whole parts are dropped; nothing is glued. */
    fun prepareParts(parts: List<String>, maxParts: Int = 3): List<String> {
        if (parts.isEmpty() || maxParts <= 0) return emptyList()
        val output = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        for (part in parts) {
            val cleaned = cleanPart(part)
            if (cleaned.isEmpty()) continue
            val key = normalizedPartKey(cleaned)
            if (key.isNotEmpty() && !seen.add(key)) continue
            if (output.size >= maxParts) break
            output += cleaned
        }
        return output
    }

    private fun normalizedPartKey(value: String): String {
        return value.filter(Char::isLetterOrDigit)
    }

    fun incomingChanged(expectedFingerprint: String, currentFingerprint: String): Boolean {
        return !IncomingConversationTracker.isCompatible(expectedFingerprint, currentFingerprint)
    }

    fun effectiveFingerprint(recomputedFingerprint: String?, originalFingerprint: String): String {
        return recomputedFingerprint?.takeIf(String::isNotBlank) ?: originalFingerprint
    }

    /**
     * Once the first bubble is sent, finish the planned reply before handling
     * newer incoming messages. Cancelling midway leaves the user with an
     * incomplete thought and makes the remaining parts impossible to retry.
     */
    fun nextPartDecision(
        sentParts: Int,
        incomingChanged: Boolean,
        staleRequested: Boolean
    ): NextPartDecision {
        return if (sentParts <= 0 && (incomingChanged || staleRequested)) {
            NextPartDecision.CANCEL_STALE
        } else {
            NextPartDecision.SEND
        }
    }
}

enum class NextPartDecision {
    SEND,
    CANCEL_STALE
}
