package com.aaiagent.engine

object IncomingConversationTracker {
    private const val MAX_TRACKED_MESSAGES = 6

    fun fingerprint(messages: List<String>): String {
        return messages
            .map(IncomingMessageTracker::fingerprint)
            .filter { it.isNotEmpty() }
            .takeLast(MAX_TRACKED_MESSAGES)
            .joinToString(separator = "\u001F")
    }

    fun isAlreadyHandled(handledFingerprint: String, currentFingerprint: String): Boolean {
        return currentFingerprint.isNotEmpty() && currentFingerprint == handledFingerprint
    }
}
