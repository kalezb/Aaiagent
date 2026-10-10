package com.aaiagent.engine

object ManualChatSyncPolicy {
    const val DEBOUNCE_MS = 800L

    fun slotKey(platform: String, contactName: String?): String {
        return platform.trim().lowercase() + "\u0000" + contactName.orEmpty().trim().lowercase()
    }

    fun shouldCapture(
        hostingEnabled: Boolean,
        inChat: Boolean,
        title: String?,
        messageCount: Int,
    ): Boolean {
        return !hostingEnabled &&
            inChat &&
            !title.isNullOrBlank() &&
            messageCount > 0
    }
}
