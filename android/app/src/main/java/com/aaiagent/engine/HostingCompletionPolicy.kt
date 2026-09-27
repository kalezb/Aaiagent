package com.aaiagent.engine

object HostingCompletionPolicy {
    fun canPerformScreenActions(mode: HostingMode): Boolean {
        return mode != HostingMode.MONITOR_ONLY
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
