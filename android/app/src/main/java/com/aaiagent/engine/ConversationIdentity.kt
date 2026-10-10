package com.aaiagent.engine

/**
 * Verifies that the chat title belongs to the conversation that was clicked.
 * Unknown titles are deliberately rejected: sending to the wrong person is
 * worse than skipping one cycle.
 */
object ConversationIdentity {
    fun matches(expected: String?, actual: String?): Boolean {
        val expectedClean = normalize(expected)
        val actualClean = normalize(actual)
        if (expectedClean.isEmpty() || actualClean.isEmpty()) return false
        if (expectedClean == "unknown" || actualClean == "unknown") return false
        if (expectedClean == actualClean) return true

        val shorter = if (expectedClean.length <= actualClean.length) expectedClean else actualClean
        val longer = if (shorter == expectedClean) actualClean else expectedClean
        val lengthDelta = longer.length - shorter.length

        // Two-character Chinese names are too easy to confuse with a suffix.
        if (shorter.length < 3 || lengthDelta > 2) return false
        return longer.startsWith(shorter) || longer.endsWith(shorter)
    }

    fun normalize(value: String?): String {
        if (value.isNullOrBlank()) return ""
        return value
            .replace(Regex("[\\s\\u200B-\\u200D\\uFEFF]+"), "")
            .replace(Regex("(?i)(正在输入|在线|离线|已读|未读)$"), "")
            .trim()
    }
}
