package com.aaiagent

import com.aaiagent.adapter.ChatPageStabilityPolicy
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
}
