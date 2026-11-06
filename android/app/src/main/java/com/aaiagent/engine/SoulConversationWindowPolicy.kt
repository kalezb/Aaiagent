package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * 聊天页只显示一条新消息、旧记录已经滚出可见范围时，是否允许接续。
 * 必须同时满足：列表预览完全对上、最后一条是对方消息、内容和上次最后一条不同。
 */
object SoulConversationWindowPolicy {
    fun canAppendLatestOutsideWindow(
        previous: List<SyncSnapshotItem>,
        messages: List<ChatMessage>,
        listPreview: String,
        listTimeText: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Boolean {
        if (previous.isEmpty() || messages.isEmpty()) return false
        if (listPreview.isBlank()) return false
        if (!ChatReadFreshnessPolicy.matches(messages, listPreview)) return false
        val latest = messages.last()
        if (latest.sender == "self") return false
        val previousLast = previous.lastOrNull() ?: return false
        if (previousLast.content.trim() != latest.content.trim()) return true

        val inboxTime = SoulMessageTime.parseToEpochMillis(listTimeText, nowMs) ?: return false
        val previousTime = previousLast.createdAt?.times(1000L) ?: return false
        return inboxTime > previousTime
    }
}
