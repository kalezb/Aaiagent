package com.aaiagent.adapter

/**
 * Soul can briefly remove the chat title/input while a dynamic sticker or
 * interaction animation is redrawing the page. Keep a very short memory of
 * the last confirmed chat page so that redraw is not mistaken for leaving
 * the conversation. Explicit list/profile/commerce pages always win.
 */
object ChatPageStabilityPolicy {
    const val GRACE_MS = 1_500L

    fun shouldTreatAsChat(
        chatDetected: Boolean,
        explicitNonChat: Boolean,
        lastChatAtMs: Long,
        nowMs: Long,
    ): Boolean {
        if (chatDetected) return true
        if (explicitNonChat) return false
        if (lastChatAtMs <= 0L || nowMs < lastChatAtMs) return false
        return nowMs - lastChatAtMs <= GRACE_MS
    }
}
