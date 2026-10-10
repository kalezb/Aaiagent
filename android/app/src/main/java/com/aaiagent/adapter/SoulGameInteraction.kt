package com.aaiagent.adapter

object SoulGameInteraction {
    private val GAME_KEYWORDS = listOf(
        "游戏",
        "桌球",
        "台球",
        "五子棋",
        "你画我猜",
        "猜拳",
        "骰子",
        "鸡尾酒",
        "大冒险",
        "真心话",
        "狼人杀",
        "剧本杀",
        "连连看",
        "斗地主",
        "麻将",
        "飞行棋",
        "象棋",
        "围棋",
        "答题"
    )

    fun isGameLabel(raw: String): Boolean {
        val label = normalize(raw)
        return label.isNotEmpty() && GAME_KEYWORDS.any(label::contains)
    }

    fun modelTextFor(raw: String): String {
        val label = normalize(raw)
        return "明确识别到对方发来 Soul 游戏互动「$label」。请礼貌婉拒一起玩游戏，不答应邀请，也不要停留在游戏话题，自然换回一个轻松的日常话题。"
    }

    private fun normalize(raw: String): String {
        return raw.trim()
            .removePrefix("[")
            .removeSuffix("]")
            .removePrefix("【")
            .removeSuffix("】")
            .trim()
    }
}
