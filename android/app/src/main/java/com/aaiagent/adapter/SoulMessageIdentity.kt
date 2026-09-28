package com.aaiagent.adapter

/**
 * Soul does not expose a stable message id in the accessibility tree. Build an
 * identity from stable visible fields only. Relative labels such as "刚刚" and
 * "1分钟前" change without a new message, so they must never change identity.
 */
object SoulMessageIdentity {
    private const val SEPARATOR = "\u001F"
    private val relativeTimePattern = Regex(
        "^(?:刚刚|刚才|片刻前|稍前|\\d+\\s*(?:秒|分钟|小时|天)前|昨天|前天|昨天\\s*\\d{1,2}:\\d{2}|前天\\s*\\d{1,2}:\\d{2})$"
    )
    private val clockTimePattern = Regex("^(?:今天\\s*)?\\d{1,2}:\\d{2}$")

    fun key(
        sender: String,
        type: String,
        content: String,
        timestampText: String,
        timestampMillis: Long?,
    ): String {
        val contentAnchor = content.trim().replace(Regex("\\s+"), " ")
        return listOf("soul", sender, type, stableTimeAnchor(timestampText, timestampMillis), contentAnchor)
            .joinToString(SEPARATOR)
    }

    private fun stableTimeAnchor(timestampText: String, timestampMillis: Long?): String {
        val text = timestampText.trim()
        if (relativeTimePattern.matches(text)) return "relative"
        if (timestampMillis != null && timestampMillis > 0L) {
            return "millis:${timestampMillis / 1_000L}"
        }
        if (text.isEmpty()) return "no-time"
        if (clockTimePattern.matches(text)) return "clock:$text"
        return "text:$text"
    }
}
