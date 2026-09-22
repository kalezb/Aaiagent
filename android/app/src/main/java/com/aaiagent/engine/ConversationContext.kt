package com.aaiagent.engine

data class ConversationContext(
    val platform: String,
    val contactId: String,
    var firstMessageAt: Long = 0L,
    var llmRequestId: Int = 0,
    var recalcCount: Int = 0
)
