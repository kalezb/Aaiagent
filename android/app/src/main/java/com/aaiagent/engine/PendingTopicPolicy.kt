package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * Compresses unanswered messages into a short, latest-first action list.
 * This is intentionally local so context planning does not add another model call.
 */
object PendingTopicPolicy {
    private const val MAX_ITEMS = 3
    private const val MAX_ITEM_CHARS = 84

    enum class TopicKind(val label: String) {
        EXPLICIT_BOUNDARY("明确越界"),
        SUGGESTIVE_BOUNDARY("暧昧暗示"),
        AFFECTION("夸赞/情绪"),
        SCHEDULE("时间安排"),
        MEAL("吃饭"),
        WEATHER("天气"),
        LOCATION("位置"),
        BUSINESS("手机/回收"),
        FOLLOW_UP("追问"),
        REQUEST("具体请求"),
        QUESTION("问题"),
        MEDIA("媒体消息"),
        GENERAL("最新内容")
    }

    data class Item(
        val kind: TopicKind,
        val text: String,
        val sourceCount: Int
    )

    data class Plan(val items: List<Item>) {
        fun prompt(): String {
            val lines = items.mapIndexed { index, item ->
                val priority = if (index == 0) "最新优先" else "补答"
                val merged = if (item.sourceCount > 1) "，同话题${item.sourceCount}条合并" else ""
                "${index + 1}. [$priority][${item.kind.label}] ${item.text}$merged"
            }
            return buildString {
                appendLine("【待处理事项】")
                lines.forEach(::appendLine)
                append("先处理第1项，再自然补答后面的不同问题；同一话题只回应一次；最多处理3项；")
                append("每个气泡只表达一个意思，不要逐条复述，不要像清单。")
            }
        }
    }

    private data class Candidate(
        val kind: TopicKind,
        val key: String,
        val text: String
    )

    private data class Group(
        val kind: TopicKind,
        val key: String,
        val text: String,
        var sourceCount: Int = 1
    )

    fun build(messages: List<ChatMessage>): Plan? {
        if (messages.size < 2) return null

        val groups = mutableListOf<Group>()
        messages.asReversed().forEach { message ->
            val candidate = candidate(message) ?: return@forEach
            val existing = groups.firstOrNull { it.key == candidate.key }
            if (existing == null) {
                groups += Group(candidate.kind, candidate.key, candidate.text)
            } else {
                existing.sourceCount += 1
            }
        }

        if (groups.isEmpty()) return null
        val items = groups.take(MAX_ITEMS).map { group ->
            Item(
                kind = group.kind,
                text = group.text.take(MAX_ITEM_CHARS),
                sourceCount = group.sourceCount
            )
        }
        return Plan(items)
    }

    private fun candidate(message: ChatMessage): Candidate? {
        val normalized = normalize(message)
        if (!isSubstantive(message, normalized)) return null

        val kind = classify(normalized, message.type)
        val key = when (kind) {
            TopicKind.EXPLICIT_BOUNDARY -> "explicit_boundary"
            TopicKind.SUGGESTIVE_BOUNDARY -> "suggestive_boundary"
            TopicKind.AFFECTION -> "affection"
            TopicKind.SCHEDULE -> "schedule"
            TopicKind.MEAL -> "meal"
            TopicKind.WEATHER -> "weather"
            TopicKind.LOCATION -> "location"
            TopicKind.BUSINESS -> "business"
            TopicKind.FOLLOW_UP -> "follow_up"
            TopicKind.MEDIA -> "media:${message.type}"
            TopicKind.REQUEST -> "request:${normalized.take(12)}"
            TopicKind.QUESTION -> "question:${normalized.take(16)}"
            TopicKind.GENERAL -> "general:${normalized.take(12)}"
        }
        return Candidate(kind, key, displayText(message, normalized))
    }

    private fun normalize(message: ChatMessage): String {
        val content = message.content.trim().replace(Regex("\\s+"), " ")
        if (content.isNotBlank()) return content
        return when (message.type) {
            "voice" -> "对方发来一条语音"
            "voice_emoji" -> "对方发来语音表情"
            "image" -> "对方发来一张图片"
            "exchange" -> "对方发来以图换图"
            "sticker" -> "对方发来一个表情"
            "interaction" -> "对方发来互动表情"
            "moment_card" -> "对方转发了你的动态"
            else -> ""
        }
    }

    private fun isSubstantive(message: ChatMessage, text: String): Boolean {
        if (message.type != "text") return text.isNotBlank()
        val compact = text.replace(Regex("[\\s，。！？!?、,.~～]"), "")
        if (compact.isEmpty()) return false
        return !TRIVIAL_TEXT.matches(compact)
    }

    private fun classify(text: String, type: String): TopicKind {
        if (type != "text") return TopicKind.MEDIA
        if (EXPLICIT_BOUNDARY.containsMatchIn(text)) return TopicKind.EXPLICIT_BOUNDARY
        if (SUGGESTIVE_BOUNDARY.containsMatchIn(text)) return TopicKind.SUGGESTIVE_BOUNDARY
        if (AFFECTION.containsMatchIn(text)) return TopicKind.AFFECTION
        if (FOLLOW_UP.containsMatchIn(text)) return TopicKind.FOLLOW_UP
        if (SCHEDULE.containsMatchIn(text)) return TopicKind.SCHEDULE
        if (MEAL.containsMatchIn(text)) return TopicKind.MEAL
        if (WEATHER.containsMatchIn(text)) return TopicKind.WEATHER
        if (LOCATION.containsMatchIn(text)) return TopicKind.LOCATION
        if (BUSINESS.containsMatchIn(text)) return TopicKind.BUSINESS
        if (REQUEST.containsMatchIn(text)) return TopicKind.REQUEST
        if (QUESTION.containsMatchIn(text)) return TopicKind.QUESTION
        return TopicKind.GENERAL
    }

    private fun displayText(message: ChatMessage, normalized: String): String {
        return when (message.type) {
            "voice" -> "语音：$normalized"
            "voice_emoji" -> "语音表情：$normalized"
            "image" -> "图片：$normalized"
            "exchange" -> "以图换图：$normalized"
            "sticker" -> "表情：$normalized"
            "interaction" -> "互动表情：$normalized"
            "moment_card" -> "动态卡片：$normalized"
            else -> normalized
        }
    }

    private val TRIVIAL_TEXT = Regex("^(?:在吗|在不在|在么|人呢|嗯+|哦+|噢+|好|好的|行|行吧|哈哈+|呵+|没事|没事了|晚安|早安)$")
    private val EXPLICIT_BOUNDARY = Regex("(?:两性|性生活|做爱|上床|开房|床事|裸照|裸体|黄腔|约炮|约你|见面|出来见|发.{0,3}(?:照片|视频)|拍.{0,3}(?:照片|视频)|交换.{0,3}(?:照片|图)|私密|隐私内容|身体细节)")
    private val SUGGESTIVE_BOUNDARY = Regex("(?:(?:让我|我来|给你).{0,3}检查|检查.{0,4}(?:你|身体|干净|洗澡)|洗干净|陪我|想不想我|想我没|睡了吗|梦到我|抱抱|亲亲)")
    private val AFFECTION = Regex("(?:好看|漂亮|气质|身材|可爱|有魅力|嘴甜|喜欢你|想你|心动|夸你|养眼)")
    private val SCHEDULE = Regex("(?:几点|明天|起床|睡觉|睡吧|晚安|早安|周末|下班|上班|有空|安排)")
    private val MEAL = Regex("(?:吃饭|吃了|吃啥|吃什么|早餐|午餐|晚餐|夜宵|饿)")
    private val WEATHER = Regex("(?:天气|下雨|晴天|温度|冷|热)")
    private val LOCATION = Regex("(?:哪里|地址|住在|工作地|两江|重庆)")
    private val BUSINESS = Regex("(?:手机|数码|回收|旧机|换机|报价|型号|上门)")
    private val FOLLOW_UP = Regex("(?:还没回|怎么不回|为什么不回|又没回|看到吗|看到了吗|在不在|人呢)")
    private val REQUEST = Regex("(?:帮我|记得|跟我说|告诉我|发我|给我|回答我)")
    private val QUESTION = Regex("[？?]|(?:吗|呢|怎么|为什么|多少|哪里|哪个|什么时候|能不能|可以吗|要不要|是不是|有没有|干嘛|做什么)")
}
