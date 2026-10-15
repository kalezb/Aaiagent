package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.ConversationTurnSnapshotPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationTurnSnapshotPolicyTest {
    @Test
    fun `snapshot records the complete current turn`() {
        val snapshot = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-1",
            messages = listOf(
                ChatMessage("other", "那你让不让我弄", timestampMillis = 1_000L),
                ChatMessage("other", "你说呀", timestampMillis = 2_000L),
                ChatMessage("other", "你说多少", timestampMillis = 3_000L),
            ),
        )

        assertEquals("turn-1", snapshot.turnId)
        assertEquals(3, snapshot.messageCount)
        assertEquals(3L, snapshot.lastMessageAt)
        assertTrue(snapshot.captureComplete)
    }

    @Test
    fun `empty message content makes the snapshot incomplete`() {
        val snapshot = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-2",
            messages = listOf(ChatMessage("other", " ")),
        )

        assertFalse(snapshot.captureComplete)
    }
}
