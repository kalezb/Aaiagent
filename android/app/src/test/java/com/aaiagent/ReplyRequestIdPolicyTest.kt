package com.aaiagent

import com.aaiagent.engine.ReplyRequestIdPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyRequestIdPolicyTest {
    @Test
    fun `same incoming turn keeps the same request id`() {
        val first = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-1",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-a",
        )
        val second = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-1",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-a",
        )

        assertEquals(first, second)
        assertTrue(first.startsWith("chat-"))
    }

    @Test
    fun `a new incoming batch gets a new request id`() {
        val first = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-1",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-a",
        )
        val second = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-2",
            incomingBatchFingerprint = "batch-b",
            historyFingerprint = "history-b",
        )

        assertNotEquals(first, second)
    }

    @Test
    fun `request id is scoped to the conversation`() {
        val first = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-1",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-a",
        )
        val second = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-2",
            latestIncomingStableToken = "message-1",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-a",
        )

        assertNotEquals(first, second)
    }

    @Test
    fun `stable message identity survives older history scrolling out`() {
        val first = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-2",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-long",
        )
        val second = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "message-2",
            incomingBatchFingerprint = "batch-a",
            historyFingerprint = "history-short",
        )

        assertEquals(first, second)
    }

    @Test
    fun `repeated identical messages with a larger batch get a new request id`() {
        val single = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "same-message",
            incomingBatchFingerprint = "one-item",
            historyFingerprint = "history",
        )
        val repeated = ReplyRequestIdPolicy.build(
            platform = "soul",
            contactId = "contact-1",
            latestIncomingStableToken = "same-message",
            incomingBatchFingerprint = "two-items",
            historyFingerprint = "history",
        )

        assertNotEquals(single, repeated)
    }
}
