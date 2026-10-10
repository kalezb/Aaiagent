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
            val timeLabel = time
            val timePrefix = timeLabel.takeIf(String::isNotEmpty)?.let { "【$it】" }.orEmpty()
            val type = typeLabel(message)
            "$timePrefix$type${message.content.trim()}"
        }

        val lead = if (spansHours) {
            "这是客户在我方最后一次回复后，跨时间连续发来的同一轮未回复消息。"
        } else {
            "这是客户在我方最后一次回复后连续发来的同一轮未回复消息。"
        }
        val pendingPlan = PendingTopicPolicy.build(incoming)?.prompt()
        val timeline = "$lead\n$lines\n" +
            "请按时间顺序理解这组未回复消息，只把最新一句当成本轮起点；" +
            "前面只有明确问题且还没回答时，才用一句补答。当前时间=${formatNow(nowMillis)}。"
        return listOf(timeline, pendingPlan.orEmpty())
            .filter(String::isNotBlank)
            .joinToString("\n")
    }

    private fun formatNow(nowMillis: Long): String {
        return formatter.format(Instant.ofEpochMilli(nowMillis).atZone(chinaZone))
    }

    private fun typeLabel(message: ChatMessage): String {
        if (message.identityKey.contains(":interaction:") ||
            message.content.contains("Soul 互动表情")
        ) {
            return "互动表情："
        }
        return when (message.type) {
            "interaction" -> "互动表情："
            "exchange" -> "以图换图："
            "image" -> "图片："
            "voice" -> "语音："
            "voice_emoji" -> "语音表情："
            "sticker" -> "表情："
            else -> ""
        }
    }
}
