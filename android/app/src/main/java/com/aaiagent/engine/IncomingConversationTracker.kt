package com.aaiagent.engine

object IncomingConversationTracker {
    private const val MAX_TRACKED_MESSAGES = 6
    private const val SEPARATOR = "\u001F"

    fun fingerprint(messages: List<String>): String {
        return messages
            .map(IncomingMessageTracker::fingerprint)
            .filter { it.isNotEmpty() }
            .takeLast(MAX_TRACKED_MESSAGES)
            .joinToString(separator = SEPARATOR)
    }

    /**
     * A shorter visible history is valid when old messages simply scrolled out of
     * view. New or changed messages still require a fresh reply.
     */
    fun isCompatible(expectedFingerprint: String, currentFingerprint: String): Boolean {
        if (expectedFingerprint.isBlank()) return false
        if (expectedFingerprint == currentFingerprint) return true
        val expected = expectedFingerprint.split(SEPARATOR).filter(String::isNotEmpty)
        val current = currentFingerprint.split(SEPARATOR).filter(String::isNotEmpty)
        return current.isNotEmpty() &&
            current.size < expected.size &&
            expected.takeLast(current.size) == current
    }

    fun isAlreadyHandled(handledFingerprint: String, currentFingerprint: String): Boolean {
        return currentFingerprint.isNotEmpty() && currentFingerprint == handledFingerprint
    }
}
