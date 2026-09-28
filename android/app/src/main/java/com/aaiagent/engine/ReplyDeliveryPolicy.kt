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
    val confirmed: Boolean = true
) {
    val isComplete: Boolean get() = status == ReplyDeliveryStatus.COMPLETE
}

object ReplyDeliveryPolicy {
    fun planParts(
        parts: List<String>,
        randomUnit: Double = kotlin.random.Random.nextDouble()
    ): List<String> {
        val cleaned = parts.map(::cleanPart).filter(String::isNotEmpty)
        if (cleaned.isEmpty()) return emptyList()

        val count = choosePartCount(cleaned, randomUnit.coerceIn(0.0, 1.0))
        if (cleaned.size == 1 && cleaned[0].length > 24) {
            return splitLongReply(cleaned[0], count)
        }
        return prepareParts(cleaned, count)
    }

    private fun choosePartCount(parts: List<String>, randomUnit: Double): Int {
        if (parts.size == 1) {
            val length = parts[0].length
            if (length <= 24) return 1
            return when {
                length <= 36 -> if (randomUnit < 0.55) 1 else 2
                length <= 56 -> if (randomUnit < 0.30) 1 else if (randomUnit < 0.78) 2 else 3
                else -> if (randomUnit < 0.18) 1 else if (randomUnit < 0.68) 2 else 3
            }
        }

        if (parts.size == 2) {
            val totalLength = parts.sumOf(String::length)
            return if (totalLength <= 32 && randomUnit < 0.45) 1 else 2
        }

        return when {
            randomUnit < 0.28 -> 1
            randomUnit < 0.78 -> 2
            else -> 3
        }
    }

    private fun splitLongReply(text: String, desiredParts: Int): List<String> {
        if (desiredParts <= 1) return listOf(text)
        val atoms = text.split(Regex("(?<=[。！？!?；;])|\\s+"))
            .map(::cleanPart)
            .filter(String::isNotEmpty)
            .flatMap { atom -> if (atom.length <= 24) listOf(atom) else atom.chunked(18) }
        if (atoms.isEmpty()) return emptyList()

        val packed = mutableListOf<String>()
        var current = ""
        for (atom in atoms) {
            val candidate = if (current.isBlank()) atom else "$current $atom"
            if (current.isNotBlank() && candidate.length > 24) {
                packed += current
                current = atom
            } else {
                current = candidate
            }
        }
        if (current.isNotBlank()) packed += current
        return packed.ifEmpty { listOf(text) }
    }

    fun delayAfterPart(part: String, randomUnit: Double = kotlin.random.Random.nextDouble()): Long {
        val normalized = randomUnit.coerceIn(0.0, 1.0)
        return if (part.length >= 16) {
            600L + (normalized * 400L).toLong()
        } else {
            200L + (normalized * 300L).toLong()
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
        if (cleaned.size != 1 || cleaned[0].length <= 24) return cleaned
        val text = cleaned[0]
        val atoms = text.split(Regex("(?<=[。！？!?；;])|\\s+"))
            .map(::cleanPart)
            .filter(String::isNotEmpty)
            .flatMap { atom -> if (atom.length <= 24) listOf(atom) else atom.chunked(18) }
        if (atoms.size <= 1) return text.chunked(20).map(::cleanPart)

        val desiredParts = minOf(maxParts.coerceAtLeast(1), maxOf(2, (text.length + 21) / 22))
        if (desiredParts <= 1 || atoms.size <= desiredParts) return prepareParts(atoms, desiredParts)

        val result = mutableListOf<String>()
        var index = 0
        while (index < atoms.size && result.size < desiredParts) {
            val remainingParts = desiredParts - result.size
            val remainingLength = atoms.drop(index).sumOf(String::length)
            val targetLength = (remainingLength + remainingParts - 1) / remainingParts
            val builder = StringBuilder()
            while (index < atoms.size) {
                val atom = atoms[index]
                val mustLeave = atoms.size - index <= remainingParts - 1
                if (builder.isNotEmpty() && (mustLeave || builder.length >= targetLength)) break
                builder.append(atom)
                index++
            }
            cleanPart(builder.toString()).takeIf(String::isNotEmpty)?.let(result::add)
        }
        if (index < atoms.size) {
            result[result.lastIndex] = cleanPart(result.last() + atoms.drop(index).joinToString(""))
        }
        return result
    }

    private fun cleanPart(value: String): String {
        return value.trim().trimEnd('。', '，', ',', '.', '~', '～', '！', '!', '？', '?', '；', ';').trim()
    }

    /**
     * Keeps natural model output unchanged up to three messages. Longer output is
     * compacted into the third message instead of forcing a fixed number of bubbles.
     */
    fun prepareParts(parts: List<String>, maxParts: Int = 3): List<String> {
        if (parts.isEmpty() || maxParts <= 0) return emptyList()
        val cleaned = parts.map(String::trim).filter(String::isNotEmpty)
        if (cleaned.size <= maxParts) return cleaned
        val head = cleaned.take(maxParts - 1)
        val mergedTail = cleaned.drop(maxParts - 1).joinToString(" ").trim()
        return if (mergedTail.isEmpty()) head else head + mergedTail
    }

    fun incomingChanged(expectedFingerprint: String, currentFingerprint: String): Boolean {
        return !IncomingConversationTracker.isCompatible(expectedFingerprint, currentFingerprint)
    }

    fun effectiveFingerprint(recomputedFingerprint: String?, originalFingerprint: String): String {
        return recomputedFingerprint?.takeIf(String::isNotBlank) ?: originalFingerprint
    }
}
