package com.aaiagent

import com.aaiagent.engine.ConversationContext
import com.aaiagent.engine.ConversationContextRetentionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationContextRetentionPolicyTest {
    private fun entry(key: String, touchedAt: Long, pending: Boolean = false) =
        ConversationContextRetentionPolicy.Entry(
            key = key,
            lastTouchedAtMs = touchedAt,
            hasPendingWork = pending,
        )

    @Test
    fun `idle conversations expire after the ttl`() {
        val now = 10_000_000L
        val evicted = ConversationContextRetentionPolicy.keysToEvict(
            entries = listOf(
                entry("old", now - ConversationContextRetentionPolicy.IDLE_TTL_MS - 1L),
                entry("fresh", now - 1_000L),
            ),
            nowMs = now,
        )
        assertEquals(listOf("old"), evicted)
    }

    @Test
    fun `conversations that still owe a reply are never evicted`() {
        val now = 10_000_000L
        val evicted = ConversationContextRetentionPolicy.keysToEvict(
            entries = listOf(
                entry("pending", now - ConversationContextRetentionPolicy.IDLE_TTL_MS * 5L, pending = true),
                entry("fresh", now - 1_000L),
            ),
            nowMs = now,
        )
        assertTrue(evicted.isEmpty())
    }

    @Test
    fun `overflow evicts the oldest idle conversations first`() {
        val now = 10_000_000L
        val entries = (1..5).map { index -> entry("c$index", now - index * 1_000L) }
        val evicted = ConversationContextRetentionPolicy.keysToEvict(
            entries = entries,
            nowMs = now,
            maxContexts = 3,
        )
        assertEquals(listOf("c5", "c4"), evicted)
    }

    @Test
    fun `automated reply memory stays bounded`() {
        val context = ConversationContext(platform = "soul", contactId = "id")
        repeat(ConversationContext.MAX_TRACKED_AUTOMATED_REPLIES + 10) { index ->
            context.rememberAutomatedReply("reply-$index")
        }
        assertEquals(
            ConversationContext.MAX_TRACKED_AUTOMATED_REPLIES,
            context.aiSentContents.size,
        )
        assertTrue(context.aiSentContents.contains("reply-49"))
    }

    @Test
    fun `touch and pending work drive the retention decision`() {
        val context = ConversationContext(platform = "soul", contactId = "id")
        context.touch(1_234L)
        assertEquals(1_234L, context.lastTouchedAtMs)
        assertTrue(!context.hasPendingWork())
        context.pendingReplyId = "reply-1"
        assertTrue(context.hasPendingWork())
    }
}
