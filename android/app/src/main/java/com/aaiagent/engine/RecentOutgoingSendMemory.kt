package com.aaiagent.engine

internal class RecentOutgoingSendMemory(
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val recent = mutableListOf<CrossContactSendGuard.Sent>()

    @Synchronized
    fun isCrossContactRepeat(text: String, contactId: String): Boolean {
        return CrossContactSendGuard.isCrossContactRepeat(
            text = text,
            contactId = contactId,
            recent = recent,
            nowMs = now(),
        )
    }

    @Synchronized
    fun remember(text: String, contactId: String) {
        CrossContactSendGuard.remember(
            recent = recent,
            text = text,
            contactId = contactId,
            nowMs = now(),
        )
    }

    @Synchronized
    internal fun size(): Int = recent.size
}
