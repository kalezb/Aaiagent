package com.aaiagent.engine

object HostingCompletionPolicy {
    fun shouldLeaveAfterRead(mode: HostingMode): Boolean {
        return mode != HostingMode.SEMI_AUTO
    }

    fun shouldReturnToMessageList(
        mode: HostingMode,
        sentAny: Boolean,
        automationStillOwned: Boolean
    ): Boolean {
        return mode == HostingMode.FULL_AUTO && sentAny && automationStillOwned
    }
}
