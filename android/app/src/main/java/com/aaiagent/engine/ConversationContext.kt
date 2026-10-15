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
    var pendingReplySentParts: Int = 0,
    var pendingReplyTotalParts: Int = 0,
    var pendingReplyStale: Boolean = false,
    var lastRepliedIncomingFingerprint: String = "",
    var lastIgnoredIncomingFingerprint: String = "",
    var lastReplySentAtMs: Long = 0L,
    var relationshipOrigin: RelationshipOrigin = RelationshipOrigin.UNKNOWN,
    var conversationStage: ConversationStage = ConversationStage.UNKNOWN,
    /** 已经回过的对方消息身份键；同一条消息 30 分钟内不再回第二次。 */
    val repliedIncomingKeys: MutableList<String> = mutableListOf(),
    var lastTouchedAtMs: Long = System.currentTimeMillis(),
) {
    fun markStableIncomingInvalidation(nowMs: Long) {
        llmRequestId++
        firstMessageAt = nowMs
        pendingReplyStale = true
    }

    fun touch(nowMs: Long = System.currentTimeMillis()) {
        lastTouchedAtMs = nowMs
    }

    fun hasPendingWork(): Boolean {
        return pendingReplyParts.isNotEmpty() || pendingReplyId.isNotBlank()
    }

    /**
     * aiSentContents only exists to keep our own bubbles out of the sync
     * outbox, so an unbounded set is pure leak. Keep the newest entries.
     */
    fun rememberAutomatedReply(content: String) {
        val value = content.trim()
        if (value.isEmpty()) return
        aiSentContents.add(value)
        while (aiSentContents.size > MAX_TRACKED_AUTOMATED_REPLIES) {
            val oldest = aiSentContents.firstOrNull() ?: break
            aiSentContents.remove(oldest)
        }
    }

    fun hasRepliedToIncoming(identityKey: String): Boolean {
        val key = identityKey.trim()
        return key.isNotEmpty() && repliedIncomingKeys.contains(key)
    }

    fun rememberRepliedIncoming(identityKey: String) {
        val key = identityKey.trim()
        if (key.isEmpty()) return
        repliedIncomingKeys.remove(key)
        repliedIncomingKeys.add(key)
        while (repliedIncomingKeys.size > MAX_TRACKED_INCOMING_KEYS) {
            repliedIncomingKeys.removeAt(0)
        }
    }

    companion object {
        const val MAX_TRACKED_AUTOMATED_REPLIES = 40
        const val MAX_TRACKED_INCOMING_KEYS = 30
    }
}
