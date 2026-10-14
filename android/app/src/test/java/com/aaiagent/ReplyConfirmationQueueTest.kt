package com.aaiagent

import com.aaiagent.data.db.entity.PendingReplyConfirmationEntity
import com.aaiagent.engine.ConversationContext
import com.aaiagent.engine.ReplyConfirmationQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyConfirmationQueueTest {
    @Test
    fun `queues a sent reply with its original content`() = runBlocking {
        val queued = mutableListOf<PendingReplyConfirmationEntity>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = ReplyConfirmationQueue(
            scope = scope,
            activeToken = { "token-1" },
            enqueueConfirmation = { queued += it },
            pendingConfirmations = { _, _ -> emptyList() },
            deleteConfirmation = {},
            markConfirmationFailed = { _, _ -> },
            confirmWithServer = { false },
        )

        try {
            assertTrue(queue.queueSentReply("reply-1", "已经发出的话"))
            assertEquals(1, queued.size)
            assertEquals("reply-1", queued.single().replyId)
            assertEquals("已经发出的话", queued.single().sentContent)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `deletes a confirmation after the server accepts it`() = runBlocking {
        val deleted = mutableListOf<String>()
        val item = PendingReplyConfirmationEntity(
            replyId = "reply-2",
            token = "token-2",
            sentContent = "hello",
        )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = ReplyConfirmationQueue(
            scope = scope,
            activeToken = { "token-2" },
            enqueueConfirmation = {},
            pendingConfirmations = { _, _ -> listOf(item) },
            deleteConfirmation = { deleted += it },
            markConfirmationFailed = { _, _ -> },
            confirmWithServer = { true },
        )

        try {
            queue.queueSentReply("reply-2", "hello")
            withTimeout(2_000) {
                while (deleted.isEmpty()) delay(10)
            }
            assertEquals(listOf("reply-2"), deleted)
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `clears the context id after queueing a pending reply`() = runBlocking {
        val queued = mutableListOf<PendingReplyConfirmationEntity>()
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-1",
            pendingReplyId = "reply-3",
            pendingReplyFullContent = "已经发出的话",
        )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = ReplyConfirmationQueue(
            scope = scope,
            activeToken = { "token-3" },
            enqueueConfirmation = { queued += it },
            pendingConfirmations = { _, _ -> emptyList() },
            deleteConfirmation = {},
            markConfirmationFailed = { _, _ -> },
            confirmWithServer = { false },
        )

        try {
            assertTrue(queue.confirmPendingReply(context))
            assertEquals(1, queued.size)
            assertEquals("", context.pendingReplyId)
            assertEquals("", context.pendingReplyFullContent)
        } finally {
            scope.cancel()
        }
    }
}
