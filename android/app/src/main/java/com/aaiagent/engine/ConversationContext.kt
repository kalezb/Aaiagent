package com.aaiagent.engine

data class ConversationContext(
    val platform: String,
    var contactId: String,
    var contactName: String = "",
    var firstMessageAt: Long = 0L,
    var llmRequestId: Int = 0,
    var recalcCount: Int = 0,
    var lastIncomingFingerprint: String = "",
    var lastRepliedIncomingFingerprint: String = ""
)
