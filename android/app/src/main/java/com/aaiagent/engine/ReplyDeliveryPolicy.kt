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
        // The model already decides where a message ends (|||). Splitting an
        // unmarked sentence locally chopped natural lines at sentence, clause
        // and even space boundaries, which read like a robot. Only fold and cap.
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
        return prepareParts(cleaned.flatMap(::splitUnmarkedLongReply), maxParts)
    }

    private fun splitUnmarkedLongReply(value: String): List<String> {
        val text = cleanPart(value)
        if (text.isEmpty()) return emptyList()
        val visibleChars = visibleLength(text)

        val sentenceParts = splitAfterSentenceTerminal(text)
        if (visibleChars >= SENTENCE_SPLIT_MIN_VISIBLE_CHARS &&
            sentenceParts.size >= 2 &&
            sentenceParts.all { visibleLength(it) >= 2 }
        ) {
            return sentenceParts
        }

        val clauseParts = splitAfterClauseTerminal(text)
        if (visibleChars >= 18 &&
            clauseParts.size in 2..4 &&
            clauseParts.all { visibleLength(it) >= 3 }
        ) {
            return clauseParts
        }

        if (visibleChars < SENTENCE_SPLIT_MIN_VISIBLE_CHARS) return listOf(text)

        val spaceParts = text.split(Regex("\\s+")).map(::cleanPart).filter(String::isNotEmpty)
        if (spaceParts.size in 2..5 &&
            spaceParts.all { visibleLength(it) >= 2 && !it.all(Char::isDigit) }
        ) {
            return spaceParts
        }
        return listOf(text)
    }

    private fun splitAfterSentenceTerminal(value: String): List<String> {
        return splitAfterTerminal(value, SENTENCE_TERMINALS)
    }

    private fun splitAfterClauseTerminal(value: String): List<String> {
        return splitAfterTerminal(value, CLAUSE_TERMINALS)
    }

    private fun splitAfterTerminal(value: String, terminal: Set<Char>): List<String> {
        val result = mutableListOf<String>()
        var start = 0
        var index = 0
        while (index < value.length) {
            if (value[index] !in terminal) {
                index++
                continue
            }
            var end = index + 1
            while (end < value.length && value[end] in terminal) end++
            cleanPart(value.substring(start, end)).takeIf(String::isNotEmpty)?.let(result::add)
            start = end
            index = end
        }
        if (start < value.length) {
            cleanPart(value.substring(start)).takeIf(String::isNotEmpty)?.let(result::add)
        }
        return result
    }

    private fun cleanPart(value: String): String {
        return value.trim()
    }

    /**
     * Keeps natural model output unchanged up to three messages. Extra fragments
     * are packed into nearby short bubbles before using the final fallback.
     */
    fun prepareParts(parts: List<String>, maxParts: Int = 3): List<String> {
        if (parts.isEmpty() || maxParts <= 0) return emptyList()
        val cleaned = foldFragments(parts.map(::cleanPart).filter(String::isNotEmpty))
        if (cleaned.size <= maxParts) return cleaned
        val packed = cleaned.toMutableList()
        while (packed.size > maxParts) {
            val mergeIndex = (0 until packed.lastIndex).minBy { index ->
                visibleLength(packed[index]) + visibleLength(packed[index + 1])
            }
            packed[mergeIndex] = joinFragments(packed[mergeIndex], packed[mergeIndex + 1])
            packed.removeAt(mergeIndex + 1)
        }
        return packed
    }

    private fun foldFragments(parts: List<String>): List<String> {
        val deduplicated = mutableListOf<String>()
        for (part in parts) {
            val key = normalizedPartKey(part)
            if (key.isNotEmpty() && normalizedPartKey(deduplicated.lastOrNull().orEmpty()) == key) continue
            deduplicated += part
        }

        val result = mutableListOf<String>()
        for (part in deduplicated) {
            val previous = result.lastOrNull()
            if (previous == null) {
                result += part
                continue
            }
            val previousIsIncomplete = !hasSentenceTerminal(previous) &&
                !hasClauseTerminal(previous) &&
                visibleLength(previous) < 24
            val currentIsTooShort = visibleLength(part) <= 1
            val shortFragmentsFitTogether = previousIsIncomplete && visibleLength(previous) + visibleLength(part) <= 16
            if (shortFragmentsFitTogether || currentIsTooShort) {
                result[result.lastIndex] = joinFragments(previous, part)
            } else {
                result += part
            }
        }
        return result
    }

    private fun joinFragments(left: String, right: String): String {
        val leftEnd = left.lastOrNull()
        val rightStart = right.firstOrNull()
        val needsSpace = leftEnd != null && rightStart != null &&
            leftEnd.isLetterOrDigit() && rightStart.isLetterOrDigit()
        return if (needsSpace) "$left $right" else left + right
    }

    private fun hasSentenceTerminal(value: String): Boolean {
        return value.trimEnd().lastOrNull() in setOf('。', '！', '？', '!', '?', '…', '；', ';')
    }

    private fun hasClauseTerminal(value: String): Boolean {
        return value.trimEnd().lastOrNull() in setOf('，', ',')
    }

    private fun visibleLength(value: String): Int {
        return value.count(Char::isLetterOrDigit)
    }

    private fun normalizedPartKey(value: String): String {
        return value.filter(Char::isLetterOrDigit)
    }

    private const val SENTENCE_SPLIT_MIN_VISIBLE_CHARS = 10
    private val SENTENCE_TERMINALS = setOf('。', '！', '？', '!', '?', '…', '；', ';')
    private val CLAUSE_TERMINALS = setOf('，', ',', '；', ';')

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
