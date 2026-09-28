package com.aaiagent.engine


enum class HostingReplyAction {
    SEND,
    FILL_INPUT_ONLY,
    OBSERVE_ONLY
}

object HostingCompletionPolicy {
    fun replyAction(mode: HostingMode): HostingReplyAction {
        return when (mode) {
            HostingMode.FULL_AUTO -> HostingReplyAction.SEND
            HostingMode.SEMI_AUTO -> HostingReplyAction.FILL_INPUT_ONLY
            HostingMode.MONITOR_ONLY -> HostingReplyAction.OBSERVE_ONLY
        }
    }

    fun ownsAutomatedChat(automationOwnedChatKey: String?, currentChatKey: String): Boolean {
        return !automationOwnedChatKey.isNullOrBlank() && automationOwnedChatKey == currentChatKey
    }

    fun canPerformScreenActions(mode: HostingMode): Boolean {
        return mode != HostingMode.MONITOR_ONLY
    }

    fun shouldRevisitRecentContact(mode: HostingMode): Boolean {
        return mode == HostingMode.FULL_AUTO
    }

    fun shouldLeaveAfterRead(mode: HostingMode): Boolean {
        return mode == HostingMode.FULL_AUTO
    }

    fun shouldReturnToMessageList(
        mode: HostingMode,
        sentAny: Boolean,
        automationStillOwned: Boolean
    ): Boolean {
        return mode == HostingMode.FULL_AUTO && sentAny && automationStillOwned
    }
}
