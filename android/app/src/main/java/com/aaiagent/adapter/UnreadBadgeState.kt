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

    /**
     * 底部"聊天"标签红点上的文字算不算还有未读。
     *
     * 显示 0 就是没有未读。以前只要文字不为空就当有未读，红点挂着"0"时会一直
     * 以为还有消息没回完，于是不停地往下翻页。
     */
    fun badgeTextMeansUnread(text: String?): Boolean {
        val normalizedText = text?.trim().orEmpty()
        if (normalizedText.isEmpty()) return false
        val number = numberPattern.find(normalizedText)?.value?.toIntOrNull()
        return number?.let { it > 0 } ?: true
    }
}
