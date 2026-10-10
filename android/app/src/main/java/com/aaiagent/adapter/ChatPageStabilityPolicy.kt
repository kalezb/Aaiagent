package com.aaiagent.adapter

/**
 * Soul can briefly remove the chat title/input while a dynamic sticker or
 * interaction animation is redrawing the page. Keep a very short memory of
 * the last confirmed chat page so that redraw is not mistaken for leaving
 * the conversation. Explicit list/profile/commerce pages always win.
 */
object ChatPageStabilityPolicy {
    const val GRACE_MS = 1_500L

    /**
     * 刚进入聊天页时，输入框和消息节点会短暂从无障碍树消失。
     * 第一次读取不能立刻退回消息列表，否则会把正在打开的会话踹掉。
     */
    fun shouldRecoverWrongPageOnAttempt(attempt: Int): Boolean = attempt > 0

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
