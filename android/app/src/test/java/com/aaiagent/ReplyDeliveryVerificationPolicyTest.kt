package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.ReplyDeliveryVerificationPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyDeliveryVerificationPolicyTest {
    @Test
    fun `send is confirmed when the new bubble is below the visible area but input is cleared`() {
        assertTrue(
            ReplyDeliveryVerificationPolicy.isSendConfirmed(
                outgoingVisible = false,
                inputCleared = true,
            )
        )
    }

    @Test
    fun `send is not confirmed while input still contains the expected text`() {
        assertFalse(
            ReplyDeliveryVerificationPolicy.isSendConfirmed(
                outgoingVisible = false,
                inputCleared = false,
            )
        )
    }

    @Test
    fun `outgoing bubble is verified after send`() {
        val messages = listOf(
            ChatMessage("other", "在吗", "text"),
            ChatMessage("self", "在的，怎么了？", "text"),
        )

        assertTrue(
            ReplyDeliveryVerificationPolicy.isOutgoingVisible(
                messages = messages,
                expectedContent = "在的，怎么了？",
            )
        )
    }

    @Test
    fun `incoming text with the same content does not count as sent`() {
        val messages = listOf(
            ChatMessage("other", "在的，怎么了？", "text"),
        )

        assertFalse(
            ReplyDeliveryVerificationPolicy.isOutgoingVisible(
                messages = messages,
                expectedContent = "在的，怎么了？",
            )
        )
    }

    @Test
    fun `whitespace-only presentation changes still match`() {
        val messages = listOf(
            ChatMessage("self", "  在的，   怎么了？ ", "text"),
        )

        assertTrue(
            ReplyDeliveryVerificationPolicy.isOutgoingVisible(
                messages = messages,
                expectedContent = "在的， 怎么了？",
            )
        )
    }
}
