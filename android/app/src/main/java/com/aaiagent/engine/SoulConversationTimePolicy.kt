package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * Soul 聊天页只在每组第一条消息上显示时间，后面的消息没有自己的时间。
 * 联系人列表行却始终显示最后一条消息时间，因此最后一条对方消息可以用列表时间校正。
 */
object SoulConversationTimePolicy {
    fun fuseLatestFromInbox(
        messages: List<ChatMessage>,
        listPreview: String,
        listTimeText: String,
        nowMs: Long = System.currentTimeMillis(),
    ): List<ChatMessage> {
        if (messages.isEmpty()) return messages
        if (listPreview.isBlank() || listTimeText.isBlank()) return messages
        if (!ChatReadFreshnessPolicy.matches(messages, listPreview)) return messages

        val latest = messages.lastOrNull() ?: return messages
        if (latest.sender == "self") return messages

        val inboxTimeMs = SoulMessageTime.parseToEpochMillis(listTimeText, nowMs) ?: return messages
        if (inboxTimeMs <= 0L) return messages
        if (latest.timestampTrusted &&
            (latest.timestampMillis ?: 0L) >= inboxTimeMs
        ) {
            return messages
        }

        return messages.dropLast(1) + latest.copy(
            timestampText = listTimeText.trim(),
            timestampMillis = inboxTimeMs,
            timestampTrusted = true,
        )
    }
}
