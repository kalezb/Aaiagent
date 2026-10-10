package com.aaiagent.adapter

object UnreadBadgeState {
    private val numberPattern = Regex("\\d+")

    fun isUnread(
        text: String?,
        description: String?,
        visible: Boolean = false,
    ): Boolean {
        // Soul sometimes renders the unread marker as a red dot with no text.
        // A visible unread_msg_number node is still a real unread signal.
        if (visible) return true

        val normalizedText = text?.trim().orEmpty()
        val hasPositiveNumber = numberPattern.find(normalizedText)
            ?.value
            ?.toIntOrNull()
            ?.let { it > 0 }
            ?: false
        if (hasPositiveNumber) return true

        val normalizedDescription = description?.trim().orEmpty()
        return normalizedText.contains("\u672a\u8bfb") ||
            normalizedDescription.contains("\u672a\u8bfb") ||
            normalizedText.contains("unread", ignoreCase = true) ||
            normalizedDescription.contains("unread", ignoreCase = true)
    }
}
