package com.aaiagent.adapter

object SoulInteractionMessage {
    const val TYPE = "interaction"

    data class Parsed(
        val actorName: String,
        val displayName: String
    )

    /**
     * Soul 会把“摸一下”渲染成系统文案：
     * “任意联系人昵称” 摸了摸我的头
     * 也兼容整句外层引号和没有引号的格式。
     *
     * 昵称必须动态解析，不能把任何测试账号写死。
     */
    private val QUOTED_NICKNAME_PATTERN = Regex(
        pattern = "^[“\"]\\s*(.*?)\\s*[”\"]\\s*摸了摸我的头\\s*$"
    )

    private val OPTIONAL_OUTER_QUOTE_PATTERN = Regex(
        pattern = "^[“\"]?\\s*(.*?)\\s*摸了摸我的头\\s*[”\"]?$"
    )

    fun parseSystemText(raw: String): Parsed? {
        val text = raw.trim()
        val match = QUOTED_NICKNAME_PATTERN.matchEntire(text)
            ?: OPTIONAL_OUTER_QUOTE_PATTERN.matchEntire(text)
            ?: return null
        val actorName = match.groupValues[1].trim().trim('“', '”', '"')
        if (actorName.isEmpty()) return null
        return Parsed(actorName = actorName, displayName = "摸一下")
    }
}
