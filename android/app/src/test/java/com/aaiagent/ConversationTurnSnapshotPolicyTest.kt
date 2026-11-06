package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.ConversationTurnSnapshotPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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
            createdAtSeconds = listOf(1L, 2L, 3L),
            contactVerified = true,
        )

        assertEquals("turn-1", snapshot.turnId)
        assertEquals(3, snapshot.messageCount)
        assertEquals(3L, snapshot.lastMessageAt)
        assertTrue(snapshot.captureComplete)
        assertTrue(snapshot.contactVerified)
        assertEquals(64, snapshot.messageDigest.length)
    }

    @Test
    fun `empty message content makes the snapshot incomplete`() {
        val snapshot = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-2",
            messages = listOf(ChatMessage("other", " ")),
            createdAtSeconds = listOf(3L),
            contactVerified = true,
        )

        assertFalse(snapshot.captureComplete)
    }

    @Test
    fun `snapshot uses the same corrected time sent to the model`() {
        val oldGroupTimeMs = 1_792_200_244_000L
        val correctedSeconds = 1_792_206_600L
        val snapshot = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-corrected",
            messages = listOf(
                ChatMessage(
                    sender = "other",
                    content = "上班嘞",
                    timestampMillis = oldGroupTimeMs,
                    timestampTrusted = false,
                ),
            ),
            createdAtSeconds = listOf(correctedSeconds),
            contactVerified = true,
        )

        assertEquals(correctedSeconds, snapshot.lastMessageAt)
    }

    @Test
    fun `voice transcript changes the turn digest`() {
        val voice = ChatMessage(
            sender = "other",
            content = "[语音]",
            type = "voice",
            identityKey = "voice-1",
        )
        val before = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-voice",
            messages = listOf(voice),
            createdAtSeconds = listOf(100L),
            contactVerified = true,
        )
        val after = ConversationTurnSnapshotPolicy.build(
            turnId = "turn-voice",
            messages = listOf(voice.copy(transcript = "我到家了")),
            createdAtSeconds = listOf(100L),
            contactVerified = true,
        )

        assertNotEquals(before.messageDigest, after.messageDigest)
    }

    @Test
    fun `message kinds use the same names as the backend contract`() {
        assertEquals("image", ConversationTurnSnapshotPolicy.messageKind("photo"))
        assertEquals("image", ConversationTurnSnapshotPolicy.messageKind("Picture"))
        assertEquals("snap", ConversationTurnSnapshotPolicy.messageKind("flash-photo"))
        assertEquals("voice_emoji", ConversationTurnSnapshotPolicy.messageKind("voice emoji"))
        assertEquals("dynamic_visual", ConversationTurnSnapshotPolicy.messageKind("dynamic visual"))
        assertEquals("unknown", ConversationTurnSnapshotPolicy.messageKind("system_interaction"))
    }

    @Test
    fun `matches the backend digest for the shared contract sample`() {
        val snapshot = ConversationTurnSnapshotPolicy.build(
            turnId = "cross-language-sample",
            messages = listOf(
                ChatMessage(
                    sender = "other",
                    content = "[语音]",
                    type = "voice",
                    transcript = "我到家了",
                    ledgerKey = "voice-1",
                ),
                ChatMessage(
                    sender = "self",
                    content = "那就先歇会儿",
                    type = "text",
                    ledgerKey = "text-2",
                ),
            ),
            createdAtSeconds = listOf(100L, 101L),
            contactVerified = true,
        )

        assertEquals(
            "cab69066eff827ce844274b47098672e3211295a6079df0167ade37993d36c71",
            snapshot.messageDigest,
        )
    }
}
