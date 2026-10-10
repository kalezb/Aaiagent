package com.aaiagent.engine

/**
 * Tracks short per-contact pauses after upstream failures. A paused contact is
 * skipped by the conversation scan; the message list itself keeps scanning.
 */
class ConversationReplyCooldownPolicy {
    private val blockedUntil = mutableMapOf<String, Long>()

    fun block(contactKey: String?, durationMs: Long, nowMs: Long = System.currentTimeMillis()) {
        val key = contactKey?.trim().orEmpty()
        if (key.isEmpty()) return
        blockedUntil[key] = nowMs + durationMs.coerceAtLeast(MIN_BLOCK_MS)
    }

    fun isBlocked(contactKey: String?, nowMs: Long = System.currentTimeMillis()): Boolean {
        val key = contactKey?.trim().orEmpty()
        if (key.isEmpty()) return false
        blockedUntil.entries.removeAll { it.value <= nowMs }
        return blockedUntil.containsKey(key)
    }

    companion object {
        const val MIN_BLOCK_MS = 1_000L
        const val UPSTREAM_ERROR_BLOCK_MS = 60_000L
    }
}
