package com.aaiagent

import com.aaiagent.engine.ConversationRecoveryCodec
import com.aaiagent.engine.InFlightConversation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationRecoveryCodecTest {
    @Test
    fun `roundtrip preserves pending reply tail`() {
        val record = InFlightConversation(
            platform = "soul",
            contactId = "contact-1",
            contactName = "Alice",
            pendingReplyParts = listOf("second", "third"),
            pendingReplyId = "reply-1",
            pendingReplyIncomingFingerprint = "incoming",
            pendingReplyBatchFingerprint = "batch",
            pendingReplyFullContent = "first|||second|||third",
            sentParts = 1,
            totalParts = 3,
            savedAtMs = 1234L
        )

        assertEquals(listOf(record), ConversationRecoveryCodec.decode(ConversationRecoveryCodec.encode(listOf(record))))
    }

    @Test
    fun `broken json is ignored`() {
        assertTrue(ConversationRecoveryCodec.decode("{broken").isEmpty())
    }

    @Test
    fun `upsert replaces the same contact and keeps the latest order`() {
        val first = InFlightConversation("soul", "contact-1", "Alice", pendingReplyParts = listOf("old"))
        val second = InFlightConversation("soul", "contact-2", "Bob", pendingReplyParts = listOf("bob"))
        val replacement = InFlightConversation("soul", "contact-1", "Alice", pendingReplyParts = listOf("new"))

        val updated = ConversationRecoveryCodec.upsert(
            listOf(first, second),
            replacement
        )

        assertEquals(listOf(second, replacement), updated)
    }

    @Test
    fun `remove deletes only the requested contact`() {
        val first = InFlightConversation("soul", "contact-1", "Alice")
        val second = InFlightConversation("soul", "contact-2", "Bob")

        assertEquals(
            listOf(second),
            ConversationRecoveryCodec.remove(listOf(first, second), "soul", "contact-1")
        )
    }

    @Test
    fun `recovery ignores stale and other-platform records`() {
        val now = 10_000L
        val current = InFlightConversation(
            platform = "soul",
            contactId = "contact-1",
            contactName = "Alice",
            savedAtMs = now - 1_000L
        )
        val stale = InFlightConversation(
            platform = "soul",
            contactId = "contact-2",
            contactName = "Bob",
            savedAtMs = now - 50_000L
        )
        val otherPlatform = InFlightConversation(
            platform = "qq",
            contactId = "contact-3",
            contactName = "Carol",
            savedAtMs = now - 1_000L
        )

        assertEquals(
            listOf(current),
            ConversationRecoveryCodec.recoverable(
                records = listOf(current, stale, otherPlatform),
                platform = "soul",
                nowMs = now,
                maxAgeMs = 20_000L
            )
        )
    }
}
