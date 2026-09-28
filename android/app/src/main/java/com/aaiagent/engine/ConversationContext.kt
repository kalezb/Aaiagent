package com.aaiagent.engine

data class ConversationContext(
    val platform: String,
    var contactId: String,
    var contactName: String = "",
    var firstMessageAt: Long = 0L,
    var llmRequestId: Int = 0,
    var recalcCount: Int = 0,
    var lastIncomingFingerprint: String = "",
    val aiSentContents: MutableSet<String> = mutableSetOf(),
    val pendingReplyParts: MutableList<String> = mutableListOf(),
    var pendingReplyId: String = "",
    var pendingReplyIncomingFingerprint: String = "",
    var pendingReplyBatchFingerprint: String = "",
    var pendingReplyFullContent: String = "",
    var pendingReplyStale: Boolean = false,
    var lastRepliedIncomingFingerprint: String = "",
    var lastIgnoredIncomingFingerprint: String = "",
    var lastLeaveTriggerKey: String = ""
)
