package com.aaiagent

import com.aaiagent.adapter.ChatPageStabilityPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatPageStabilityPolicyTest {
    @Test
    fun `first unreadable chat frame gets a grace period before navigation`() {
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(0))
        assertTrue(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(1))
    }

    @Test
    fun `recent chat detection survives a transient redraw only inside the grace window`() {
        assertTrue(
            ChatPageStabilityPolicy.shouldTreatAsChat(
                chatDetected = false,
                explicitNonChat = false,
                lastChatAtMs = 1_000L,
                nowMs = 2_000L,
            )
        )
        assertFalse(
            ChatPageStabilityPolicy.shouldTreatAsChat(
                chatDetected = false,
                explicitNonChat = false,
                lastChatAtMs = 1_000L,
                nowMs = 3_000L,
            )
        )
    }

    @Test
    fun `transient overlay does not trigger wrong-page recovery on attempt 1 (700ms)`() {
        // 当处于动效遮挡状态时，绝不在 attempt 1 (700ms) 时触发退回消息列表逻辑
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(0, hasTransientOverlay = true))
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(1, hasTransientOverlay = true))
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(2, hasTransientOverlay = true))
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(3, hasTransientOverlay = true))
        assertFalse(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(4, hasTransientOverlay = true))
        // 达到上限（3.5~4秒对应轮次）才允许兜底退回
        assertTrue(ChatPageStabilityPolicy.shouldRecoverWrongPageOnAttempt(5, hasTransientOverlay = true))
    }

    @Test
    fun `transient overlay extends chat grace window up to 4 seconds`() {
        // 在动效遮挡下，3秒（3000ms）仍在 4000ms 保护窗口内
        assertTrue(
            ChatPageStabilityPolicy.shouldTreatAsChat(
                chatDetected = false,
                explicitNonChat = false,
                lastChatAtMs = 1_000L,
                nowMs = 4_000L,
                hasTransientOverlay = true,
            )
        )
        // 超过 4000ms 保护窗口则不再视为聊天页
        assertFalse(
            ChatPageStabilityPolicy.shouldTreatAsChat(
                chatDetected = false,
                explicitNonChat = false,
                lastChatAtMs = 1_000L,
                nowMs = 5_500L,
                hasTransientOverlay = true,
            )
        )
    }

    @Test
    fun `transient overlay specifies continuous retry delays for steady wait`() {
        assertEquals(700L, ChatPageStabilityPolicy.retryDelayMs(0, hasTransientOverlay = true))
        assertEquals(700L, ChatPageStabilityPolicy.retryDelayMs(1, hasTransientOverlay = true))
        assertEquals(700L, ChatPageStabilityPolicy.retryDelayMs(2, hasTransientOverlay = true))

        assertEquals(700L, ChatPageStabilityPolicy.retryDelayMs(0, hasTransientOverlay = false))
        assertEquals(0L, ChatPageStabilityPolicy.retryDelayMs(1, hasTransientOverlay = false))
    }
}
