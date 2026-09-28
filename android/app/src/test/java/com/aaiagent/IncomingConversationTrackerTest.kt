package com.aaiagent

import com.aaiagent.engine.IncomingConversationTracker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingConversationTrackerTest {
    @Test
    fun `same incoming batch keeps the same fingerprint after replies are added`() {
        val beforeReply = listOf("text:hello", "text:are you there")
        val afterReplyIncomingMessages = listOf("text:hello", "text:are you there")

        assertEquals(
            IncomingConversationTracker.fingerprint(beforeReply),
            IncomingConversationTracker.fingerprint(afterReplyIncomingMessages)
        )
    }

    @Test
    fun `a new incoming message changes the fingerprint`() {
        val previous = listOf("text:hello", "text:are you there")
        val current = listOf("text:hello", "text:are you there", "text:new message")

        assertNotEquals(
            IncomingConversationTracker.fingerprint(previous),
            IncomingConversationTracker.fingerprint(current)
        )
    }

    @Test
    fun `an already handled incoming batch is not replied to twice`() {
        val messages = listOf("text:hello", "text:are you there")
        val fingerprint = IncomingConversationTracker.fingerprint(messages)

        assertTrue(IncomingConversationTracker.isAlreadyHandled(fingerprint, fingerprint))
        assertFalse(IncomingConversationTracker.isAlreadyHandled(fingerprint, ""))
    }

    @Test
    fun `a transiently empty accessibility snapshot does not invalidate a pending reply`() {
        assertTrue(IncomingConversationTracker.isCompatible("text:hello\u001Ftext:there", ""))
    }

    @Test
    fun `a partially visible older window remains compatible`() {
        val expected = listOf("text:one", "text:two", "text:three")
        val current = listOf("text:two", "text:three")

        assertTrue(
            IncomingConversationTracker.isCompatible(
                IncomingConversationTracker.fingerprint(expected),
                IncomingConversationTracker.fingerprint(current)
            )
        )
    }

    @Test
    fun `a genuinely appended message remains incompatible`() {
        assertFalse(
            IncomingConversationTracker.isCompatible(
                "text:one\u001Ftext:two",
                "text:one\u001Ftext:two\u001Ftext:three"
            )
        )
    }
}
