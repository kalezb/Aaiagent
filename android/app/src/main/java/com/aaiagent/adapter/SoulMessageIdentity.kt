package com.aaiagent.adapter

/**
 * Soul does not expose a stable message id in the accessibility tree. Build an
 * identity from the visible fields we do have, including content, so two
 * different messages in the same timestamp bucket cannot collapse into one.
 */
object SoulMessageIdentity {
    private const val SEPARATOR = "\u001F"

    fun key(
        sender: String,
        type: String,
        content: String,
        timestampText: String,
        timestampMillis: Long?
    ): String {
        val timeAnchor = timestampMillis?.toString()
            ?: timestampText.trim().takeIf(String::isNotEmpty)?.let { "text:$it" }
            ?: "no-time"
        val contentAnchor = content.trim().replace(Regex("\\s+"), " ")
        return listOf("soul", sender, type, timeAnchor, contentAnchor)
            .joinToString(SEPARATOR)
    }
}
