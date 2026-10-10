package com.aaiagent.engine

import java.security.MessageDigest

/**
 * Builds a request id from the incoming turn instead of from process-local
 * randomness. The backend uses (token, request_id) as its pending-reply key, so
 * rescanning the same incoming turn must not create a second model reply.
 */
object ReplyRequestIdPolicy {
    fun build(
        platform: String,
        contactId: String,
        latestIncomingStableToken: String,
        incomingBatchFingerprint: String,
        historyFingerprint: String
    ): String {
        val normalizedPlatform = platform.trim().lowercase()
        val normalizedContact = contactId.trim()
        val stableTurn = listOf(
            latestIncomingStableToken.trim(),
            incomingBatchFingerprint.trim()
        ).filter(String::isNotEmpty).joinToString(separator = "\u001F")
            .ifBlank { historyFingerprint.trim() }
        val seed = listOf(
            normalizedPlatform,
            normalizedContact,
            stableTurn
        ).joinToString(separator = "\u001F")
        return "chat-" + sha256(seed)
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(value.toByteArray(Charsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}
