package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Builds a compact chronological hint for a multi-message unanswered batch.
 * The raw messages remain in the request; this hint only tells the model how
 * to read them as one continuous episode instead of separate replies.
 */
object UnansweredTimeline {
    private const val MAX_LINES = 12
    private const val MULTI_DAY_GAP_MS = 6 * 60 * 60 * 1000L
    private val chinaZone = ZoneId.of("Asia/Shanghai")
    private val formatter = DateTimeFormatter.ofPattern("M月d日 HH:mm")

    fun build(messages: List<ChatMessage>, nowMillis: Long = System.currentTimeMillis()): String? {
        val incoming = messages.filter { it.sender != "self" }
        if (incoming.size < 2) return null

        val firstAt = incoming.mapNotNull { it.timestampMillis }.firstOrNull()
        val lastAt = incoming.mapNotNull { it.timestampMillis }.lastOrNull()
        val spansHours = firstAt != null && lastAt != null && lastAt - firstAt >= MULTI_DAY_GAP_MS

        val lines = incoming.takeLast(MAX_LINES).joinToString("\n") { message ->
            val time = message.timestampText.trim().ifBlank {
                message.timestampMillis
                    ?.let { formatter.format(Instant.ofEpochMilli(it).atZone(chinaZone)) }
                    .orEmpty()
            }
            val relativeAge = message.timestampMillis?.let { relativeAgeLabel(it, nowMillis) }
            val timeLabel = listOf(time, relativeAge.orEmpty())
                .filter(String::isNotBlank)
                .joinToString("，")
            val timePrefix = timeLabel.takeIf(String::isNotEmpty)?.let { "【$it】" }.orEmpty()
            val type = typeLabel(message)
            "$timePrefix$type${message.content.trim()}"
        }

        val lead = if (spansHours) {
            "这是客户在我方最后一次回复后，跨时间连续发来的同一轮未回复消息。"
        } else {
            "这是客户在我方最后一次回复后连续发来的同一轮未回复消息。"
        }
        return "$lead\n$lines\n" +
            "你是真人，不会一直盯着手机。请把这当成同一次回来看到的连续消息，" +
            "按时间顺序自然接住，优先回最新一条。当前时间=${formatNow(nowMillis)}。"
    }

    private fun formatNow(nowMillis: Long): String {
        return formatter.format(Instant.ofEpochMilli(nowMillis).atZone(chinaZone))
    }

    private fun relativeAgeLabel(epochMillis: Long, nowMillis: Long): String? {
        val seconds = ((nowMillis - epochMillis) / 1000L).coerceAtLeast(0L)
        if (seconds < 5 * 60L) return null
        if (seconds < 60 * 60L) return "${(seconds / 60L).coerceAtLeast(1L)}分钟前"
        if (seconds < 24 * 60 * 60L) {
            val hours = seconds / 3600L
            val minutes = (seconds % 3600L) / 60L
            return if (minutes > 0) "${hours}小时${minutes}分前" else "${hours}小时前"
        }
        val days = seconds / (24 * 60 * 60L)
        return if (days < 30) "${days}天前" else "${days / 30}个月前"
    }

    private fun typeLabel(message: ChatMessage): String {
        if (message.identityKey.contains(":interaction:") ||
            message.content.contains("Soul 互动表情")
        ) {
            return "互动表情："
        }
        return when (message.type) {
            "interaction" -> "互动表情："
            "moment_card" -> "分享动态："
            "exchange" -> "以图换图："
            "image" -> "图片："
            "voice" -> "语音："
            "voice_emoji" -> "语音表情："
            "sticker" -> "表情："
            else -> ""
        }
    }
}
