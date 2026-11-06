package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.network.ChatTurnSnapshot
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * 每次请求都带一张这一轮聊天的身份证。
 * 后台先核对条数和最后一条时间，对不上就不生成回复，让手机重新读一次。
 */
object ConversationTurnSnapshotPolicy {
    private val messageKinds = setOf(
        "text",
        "voice",
        "voice_emoji",
        "image",
        "snap",
        "sticker",
        "dynamic_visual",
        "interaction",
        "exchange",
        "video",
        "moment_card",
        "unknown",
    )

    fun build(
        turnId: String,
        messages: List<ChatMessage>,
        createdAtSeconds: List<Long>,
        contactVerified: Boolean,
    ): ChatTurnSnapshot {
        // 必须和真正发给模型的 created_at 使用同一套时间，不能一边用页面旧分组时间，
        // 一边用补好的顺序时间，否则云端会把正确的读取误判成快照不一致。
        val lastAtSeconds = createdAtSeconds.getOrNull(messages.lastIndex) ?: 0L
        return ChatTurnSnapshot(
            turnId = turnId.trim(),
            messageCount = messages.size,
            lastMessageAt = lastAtSeconds,
            captureComplete = messages.isNotEmpty() && messages.all {
                it.content.trim().isNotEmpty()
            },
            contactVerified = contactVerified,
            messageDigest = messageDigest(messages, createdAtSeconds),
        )
    }

    fun clientMessageId(message: ChatMessage, index: Int): String {
        return sequence {
            yield(message.ledgerKey.trim())
            yield(message.identityKey.trim())
            yield("seq:$index")
        }.firstOrNull(String::isNotBlank).orEmpty()
    }

    fun transcriptStatus(message: ChatMessage, kind: String): String {
        if (kind != "voice") return "not_applicable"
        if (message.transcript.isNotBlank()) return "complete"
        if (Regex("(?:语音转文字|转写)[：:]").containsMatchIn(message.content)) return "complete"
        return "missing"
    }

    fun messageKind(value: String): String {
        val normalized = value.trim().lowercase().replace(Regex("[\\s-]+"), "_")
        return when (normalized) {
            "photo", "picture" -> "image"
            "flash_photo", "flash" -> "snap"
            in messageKinds -> normalized
            else -> "unknown"
        }
    }

    private fun messageDigest(
        messages: List<ChatMessage>,
        createdAtSeconds: List<Long>,
    ): String {
        val canonical = messages.mapIndexed { index, message ->
            val kind = messageKind(message.type)
            listOf(
                index,
                if (message.sender == "self") "assistant" else "user",
                kind,
                message.content.trim(),
                message.transcript.trim(),
                transcriptStatus(message, kind),
                clientMessageId(message, index),
                createdAtSeconds.getOrElse(index) { 0L },
            ).joinToString("\u001f")
        }.joinToString("\u001e")
        val bytes = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
