package com.aaiagent.engine

/**
 * Keeps the in-memory conversation table bounded.
 *
 * Every contact ever seen created a ConversationContext that was never
 * released, so a long hosting run grew without limit. Conversations that still
 * owe a reply are never evicted; the rest expire after a long idle window, and
 * the oldest idle entries go first if the table is still too large.
 */
object ConversationContextRetentionPolicy {
    const val MAX_CONTEXTS = 120
    const val IDLE_TTL_MS = 2 * 60 * 60 * 1000L

    data class Entry(
        val key: String,
        val lastTouchedAtMs: Long,
        val hasPendingWork: Boolean,
    )

    fun keysToEvict(
        entries: List<Entry>,
        nowMs: Long,
        maxContexts: Int = MAX_CONTEXTS,
        idleTtlMs: Long = IDLE_TTL_MS,
    ): List<String> {
        if (maxContexts <= 0 || entries.isEmpty()) return emptyList()
        val evictable = entries.filter { !it.hasPendingWork }
        val expired = evictable
            .filter { nowMs - it.lastTouchedAtMs >= idleTtlMs }
            .map { it.key }
        val expiredKeys = expired.toSet()
        val remaining = entries.filterNot { it.key in expiredKeys }
        if (remaining.size <= maxContexts) return expired
        val overflow = remaining
            .filter { !it.hasPendingWork }
            .sortedBy { it.lastTouchedAtMs }
            .take(remaining.size - maxContexts)
            .map { it.key }
        return expired + overflow
    }
}
