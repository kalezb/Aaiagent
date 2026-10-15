package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.network.ChatTurnSnapshot

/**
 * 每次请求都带一张这一轮聊天的身份证。
 * 后台先核对条数和最后一条时间，对不上就不生成回复，让手机重新读一次。
 */
object ConversationTurnSnapshotPolicy {
    fun build(
        turnId: String,
        messages: List<ChatMessage>,
    ): ChatTurnSnapshot {
        val latest = messages.lastOrNull()
        val lastAtSeconds = (latest?.timestampMillis ?: 0L) / 1000L
        return ChatTurnSnapshot(
            turnId = turnId.trim(),
            messageCount = messages.size,
            lastMessageAt = lastAtSeconds,
            captureComplete = messages.isNotEmpty() && messages.all {
                it.content.trim().isNotEmpty()
            },
        )
    }
}
