package com.aaiagent.adapter

/**
 * Soul can briefly remove the chat title/input while a dynamic sticker or
 * interaction animation is redrawing the page. Keep a very short memory of
 * the last confirmed chat page so that redraw is not mistaken for leaving
 * the conversation. Explicit list/profile/commerce pages always win.
 */
object ChatPageStabilityPolicy {
    const val GRACE_MS = 1_500L
    const val OVERLAY_GRACE_MS = 4_000L
    const val OVERLAY_MAX_RECOVER_ATTEMPTS = 5
    const val OVERLAY_RETRY_DELAY_MS = 700L
    const val NORMAL_RETRY_DELAY_MS = 700L

    /**
     * 刚进入聊天页时，输入框和消息节点会短暂从无障碍树消失。
     * 第一次读取不能立刻退回消息列表，否则会把正在打开的会话踹掉。
     * 当处于动效遮挡状态时（hasTransientOverlay = true），平稳等待（最长等待 3.5~4 秒），
     * 严禁在 attempt 1 (700ms) 时触发退回消息列表逻辑。
     */
    fun shouldRecoverWrongPageOnAttempt(
        attempt: Int,
        hasTransientOverlay: Boolean = false,
    ): Boolean {
        if (hasTransientOverlay) {
            return attempt >= OVERLAY_MAX_RECOVER_ATTEMPTS
        }
        return attempt > 0
    }

    fun retryDelayMs(
        attempt: Int,
        hasTransientOverlay: Boolean = false,
    ): Long {
        return if (hasTransientOverlay) {
            OVERLAY_RETRY_DELAY_MS
        } else if (attempt == 0) {
            NORMAL_RETRY_DELAY_MS
        } else {
            0L
        }
    }

    fun shouldTreatAsChat(
        chatDetected: Boolean,
        explicitNonChat: Boolean,
        lastChatAtMs: Long,
        nowMs: Long,
        hasTransientOverlay: Boolean = false,
    ): Boolean {
        if (chatDetected) return true
        if (explicitNonChat) return false
        if (lastChatAtMs <= 0L || nowMs < lastChatAtMs) return false
        val grace = if (hasTransientOverlay) OVERLAY_GRACE_MS else GRACE_MS
        return nowMs - lastChatAtMs <= grace
    }
}
