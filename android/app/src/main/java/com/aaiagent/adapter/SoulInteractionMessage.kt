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
    private data class SystemAction(
        val quotedNicknamePattern: Regex,
        val optionalOuterQuotePattern: Regex,
        val displayName: String
    )

    private val ACTIONS = listOf(
        action("摸了摸我的头", "摸一下"),
        action("弹了弹我", "弹一下")
    )

    private fun action(text: String, displayName: String): SystemAction {
        val escaped = Regex.escape(text)
        return SystemAction(
            quotedNicknamePattern = Regex(
                "^[“\"]\\s*(.*?)\\s*[”\"]\\s*$escaped\\s*$"
            ),
            optionalOuterQuotePattern = Regex(
                "^[“\"]?\\s*(.*?)\\s*$escaped\\s*[”\"]?$"
            ),
            displayName = displayName
        )
    }

    fun parseSystemText(raw: String): Parsed? {
        val text = raw.trim()
        for (action in ACTIONS) {
            val match = action.quotedNicknamePattern.matchEntire(text)
                ?: action.optionalOuterQuotePattern.matchEntire(text)
                ?: continue
            val actorName = match.groupValues[1].trim().trim('“', '”', '"')
            if (actorName.isEmpty()) continue
            return Parsed(actorName = actorName, displayName = action.displayName)
        }
        return null
    }
}
