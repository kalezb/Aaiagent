package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

object ConversationReadIdentityPolicy {
    /** 内容级身份：跨多次读取稳定，不使用会变化的相对时间标签。 */
    fun incomingContentKey(message: ChatMessage): String {
        if (message.ledgerKey.isNotBlank()) return "ledger:${message.ledgerKey}"
        return listOf(
            message.sender,
            message.type,
            message.content.trim().replace(Regex("\\s+"), " "),
        ).joinToString("|")
    }

    fun matchesListPreview(
        messages: List<ChatMessage>,
        listPreview: String,
    ): Boolean = ChatReadFreshnessPolicy.matches(messages, listPreview)
}
