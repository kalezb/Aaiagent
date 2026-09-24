package com.aaiagent.engine

object HostingCompletionPolicy {
    fun shouldReturnToMessageList(
        mode: HostingMode,
        sentAny: Boolean,
        automationStillOwned: Boolean
    ): Boolean {
        return mode == HostingMode.FULL_AUTO && sentAny && automationStillOwned
    }
}
