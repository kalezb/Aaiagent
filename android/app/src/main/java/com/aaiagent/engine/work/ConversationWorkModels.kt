package com.aaiagent.engine.work

data class ConversationIdentity(
    val platform: String,
    val stableId: String,
    val displayName: String,
    val preview: String = "",
    val pageIndex: Int = 0,
    val unreadCount: Int = 0,
    val confidence: Float = 1f,
    val note: String = "",
    val lastMessageTime: String = "",
    val origin: String = "",
) {
    val key: String
        get() = platform.trim().lowercase() + ":" + stableId.trim()
}

enum class ConversationWorkState {
    DISCOVERED,
    OPENING,
    READING,
    WAITING_REPLY,
    READY_TO_SEND,
    SENDING,
    RETURNING,
    COMPLETE,
    RETRY_LATER,
    BLOCKED,
}

data class ConversationWorkItem(
    val identity: ConversationIdentity,
    val state: ConversationWorkState = ConversationWorkState.DISCOVERED,
    val discoveredAtMs: Long,
    val updatedAtMs: Long = discoveredAtMs,
    val attempts: Int = 0,
    val nextAttemptAtMs: Long = 0L,
    val replyId: String = "",
    val replyFingerprint: String = "",
    val sentParts: Int = 0,
    val totalParts: Int = 0,
    val lastReason: String = "",
) {
    val isComplete: Boolean get() = state == ConversationWorkState.COMPLETE
    val isBlocked: Boolean get() = state == ConversationWorkState.BLOCKED
    val isWaitingForRetry: Boolean get() = state == ConversationWorkState.RETRY_LATER
}

sealed interface ConversationWorkEvent {
    data object OpenRequested : ConversationWorkEvent
    data object ChatVerified : ConversationWorkEvent
    data object ReadCompleted : ConversationWorkEvent
    data object ReplyReady : ConversationWorkEvent
    data class ReplyNotNeeded(val reason: String = "") : ConversationWorkEvent
    data object SendStarted : ConversationWorkEvent
    data class SendPartConfirmed(val sentParts: Int) : ConversationWorkEvent
    data object SendVerified : ConversationWorkEvent
    data object ReturnedToList : ConversationWorkEvent
    data class RetryRequested(val reason: String, val delayMs: Long = 0L) : ConversationWorkEvent
    data class Blocked(val reason: String) : ConversationWorkEvent
}

data class ConversationWorkTransition(
    val item: ConversationWorkItem,
    val accepted: Boolean,
    val reason: String,
)
