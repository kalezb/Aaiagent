package com.aaiagent.adapter

object SoulConversationLockPolicy {
    const val RETRY_COOLDOWN_MS = 10 * 60 * 1000L

    fun isLockDialog(
        title: String?,
        body: String?,
        unlockButton: String?,
    ): Boolean {
        val normalizedTitle = title.orEmpty().trim()
        val normalizedBody = body.orEmpty().trim()
        val normalizedButton = unlockButton.orEmpty().trim()
        if (normalizedTitle.contains("对话框暂时锁定")) return true
        return normalizedButton.contains("解锁该对话框") &&
            normalizedBody.contains("暂时锁定")
    }

    fun shouldAttempt(nowMs: Long, lastAttemptAtMs: Long): Boolean {
        if (lastAttemptAtMs <= 0L) return true
        return nowMs - lastAttemptAtMs >= RETRY_COOLDOWN_MS
    }
}
