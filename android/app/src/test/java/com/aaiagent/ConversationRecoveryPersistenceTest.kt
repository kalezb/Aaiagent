package com.aaiagent

import com.aaiagent.engine.ConversationContext
import com.aaiagent.engine.ConversationRecoveryPersistence
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationRecoveryPersistenceTest {
    @Test
    fun `saves and restores pending reply details`() = runBlocking {
        var stored: String? = null
        val persistence = ConversationRecoveryPersistence(
            readValue = { stored },
            writeValue = { stored = it },
        )
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
            pendingReplyParts = mutableListOf("第一句", "第二句"),
            pendingReplyId = "reply-1",
            pendingReplyIncomingFingerprint = "incoming",
            pendingReplyBatchFingerprint = "batch",
            pendingReplyFullContent = "第一句|||第二句",
            pendingReplySentParts = 1,
            pendingReplyTotalParts = 2,
        )

        persistence.save(context)
        val recovered = persistence.recoverable("soul", System.currentTimeMillis())

        assertEquals(1, recovered.size)
        assertEquals("reply-1", recovered.single().pendingReplyId)
        assertEquals(1, recovered.single().sentParts)
        assertEquals(2, recovered.single().totalParts)
    }

    @Test
    fun `removes recovery data when the conversation has no pending work`() = runBlocking {
        var stored: String? = null
        val persistence = ConversationRecoveryPersistence(
            readValue = { stored },
            writeValue = { stored = it },
        )
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-2",
            pendingReplyId = "reply-2",
        )

        persistence.save(context)
        context.pendingReplyId = ""
        persistence.reconcile(context)
        val recovered = persistence.recoverable("soul", System.currentTimeMillis())

        assertTrue(recovered.isEmpty())
    }
}
