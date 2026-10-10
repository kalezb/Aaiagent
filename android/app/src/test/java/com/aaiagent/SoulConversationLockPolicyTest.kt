package com.aaiagent

import com.aaiagent.adapter.SoulConversationLockPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulConversationLockPolicyTest {
    @Test
    fun `recognizes the Soul conversation lock dialog`() {
        assertTrue(
            SoulConversationLockPolicy.isLockDialog(
                title = "对话框暂时锁定",
                body = "请提高警惕，注意防范诈骗",
                unlockButton = "解锁该对话框",
            )
        )
        assertFalse(
            SoulConversationLockPolicy.isLockDialog(
                title = "C",
                body = "普通聊天",
                unlockButton = null,
            )
        )
    }

    @Test
    fun `failed unlock retries only after the cooldown`() {
        val now = 100_000L
        assertTrue(SoulConversationLockPolicy.shouldAttempt(now, lastAttemptAtMs = 0L))
        assertFalse(SoulConversationLockPolicy.shouldAttempt(now, lastAttemptAtMs = now - 10_000L))
        assertTrue(
            SoulConversationLockPolicy.shouldAttempt(
                now,
                lastAttemptAtMs = now - SoulConversationLockPolicy.RETRY_COOLDOWN_MS,
            )
        )
    }
}
