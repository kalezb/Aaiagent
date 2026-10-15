package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * 手机端有时会在回到会话页后，才把一条很早发来的消息重新读出来。
 * 这条消息如果早于我们刚刚成功发出去的那条回复，就属于已经被这轮覆盖的旧消息，
 * 不能再当成新一轮去生成，否则就会出现同一句回复两遍、后面还粘一个字的穿帮。
 */
object IncomingMessageStalenessPolicy {
    fun shouldTreatAsAlreadyHandled(
        messages: List<ChatMessage>,
        lastReplySentAtMs: Long,
    ): Boolean {
        if (lastReplySentAtMs <= 0L || messages.isEmpty()) return false
        return messages.all { message ->
            val timestamp = message.timestampMillis ?: 0L
            timestamp > 0L && timestamp <= lastReplySentAtMs
        }
    }
}
