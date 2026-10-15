package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.IncomingMessageStalenessPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingMessageStalenessPolicyTest {
    @Test
    fun `message older than our last reply is treated as already handled`() {
        val message = ChatMessage(
            sender = "other",
            content = "你说呀",
            timestampMillis = 1_000L,
        )

        assertTrue(
            IncomingMessageStalenessPolicy.shouldTreatAsAlreadyHandled(
                messages = listOf(message),
                lastReplySentAtMs = 2_000L,
            )
        )
    }

    @Test
    fun `message after our last reply still gets a new reply`() {
        val message = ChatMessage(
            sender = "other",
            content = "你说多少",
            timestampMillis = 3_000L,
        )

        assertFalse(
            IncomingMessageStalenessPolicy.shouldTreatAsAlreadyHandled(
                messages = listOf(message),
                lastReplySentAtMs = 2_000L,
            )
        )
    }

    @Test
    fun `unknown timestamp is never dropped as stale`() {
        val message = ChatMessage(sender = "other", content = "在吗")

        assertFalse(
            IncomingMessageStalenessPolicy.shouldTreatAsAlreadyHandled(
                messages = listOf(message),
                lastReplySentAtMs = 2_000L,
            )
        )
    }
}
