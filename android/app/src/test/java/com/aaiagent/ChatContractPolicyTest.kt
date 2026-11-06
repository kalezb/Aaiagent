package com.aaiagent

import com.aaiagent.engine.ChatContractPolicy
import com.aaiagent.network.ChatResponse
import com.aaiagent.network.ChatTurnSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatContractPolicyTest {
    private val snapshot = ChatTurnSnapshot(
        turnId = "turn-1",
        messageCount = 2,
        lastMessageAt = 100,
        captureComplete = true,
        contactVerified = true,
        messageDigest = "abc123",
    )

    @Test
    fun `accepts a response bound to the exact captured turn`() {
        val response = ChatResponse(
            schemaVersion = 2,
            turnId = "turn-1",
            inputDigest = "abc123",
            action = "send",
            reply = "吃了吗|||我刚吃完",
            replyParts = listOf("吃了吗", "我刚吃完"),
            media = null,
            replyId = "reply-1",
            error = null,
        )

        assertTrue(ChatContractPolicy.validate(snapshot, response).ok)
        assertEquals("吃了吗|||我刚吃完", ChatContractPolicy.finalReplyText(response))
    }

    @Test
    fun `rejects a reply produced from different messages`() {
        val response = ChatResponse(
            schemaVersion = 2,
            turnId = "turn-1",
            inputDigest = "different",
            action = "send",
            reply = "在呢",
            replyParts = listOf("在呢"),
            media = null,
            replyId = "reply-1",
            error = null,
        )

        val result = ChatContractPolicy.validate(snapshot, response)
        assertFalse(result.ok)
        assertEquals("response_input_digest_mismatch", result.reason)
    }

    @Test
    fun `rejects an old reply that has no turn contract`() {
        val response = ChatResponse(
            action = "send",
            reply = "在呢",
            media = null,
            replyId = "reply-1",
            error = null,
        )

        val result = ChatContractPolicy.validate(snapshot, response)
        assertFalse(result.ok)
        assertEquals("response_contract_missing", result.reason)
    }

    @Test
    fun `requires final bubbles for every text reply`() {
        val response = ChatResponse(
            schemaVersion = 2,
            turnId = "turn-1",
            inputDigest = "abc123",
            action = "send",
            reply = "在呢",
            media = null,
            replyId = "reply-1",
            error = null,
        )

        val result = ChatContractPolicy.validate(snapshot, response)
        assertFalse(result.ok)
        assertEquals("response_reply_parts_missing", result.reason)
    }

    @Test
    fun `allows a media reply without a teaser`() {
        val response = ChatResponse(
            schemaVersion = 2,
            turnId = "turn-1",
            inputDigest = "abc123",
            action = "send_media",
            reply = null,
            media = null,
            replyId = "reply-1",
            error = null,
        )

        assertTrue(ChatContractPolicy.validate(snapshot, response).ok)
    }

    @Test
    fun `treats a null reply parts field as missing instead of crashing`() {
        val response = ChatResponse(
            schemaVersion = 2,
            turnId = "turn-1",
            inputDigest = "abc123",
            action = "send",
            reply = "在呢",
            replyParts = null,
            media = null,
            replyId = "reply-1",
            error = null,
        )

        val result = ChatContractPolicy.validate(snapshot, response)

        assertFalse(result.ok)
        assertEquals("response_reply_parts_missing", result.reason)
    }
}
