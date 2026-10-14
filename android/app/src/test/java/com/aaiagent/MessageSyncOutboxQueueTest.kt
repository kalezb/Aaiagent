package com.aaiagent

import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.engine.MessageSyncOutboxQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageSyncOutboxQueueTest {
    @Test
    fun `deletes uploaded messages after the backend accepts them`() = runBlocking {
        val item = message("sync-1", attempts = 0)
        val deleted = mutableListOf<List<String>>()
        val failed = mutableListOf<List<String>>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = MessageSyncOutboxQueue(
            scope = scope,
            pendingMessages = { _, _ -> listOf(item) },
            deleteMessages = { deleted += it },
            markMessagesFailed = { ids, _ -> failed += ids },
            syncMessages = { true },
        )

        try {
            queue.flushSerially()
            assertEquals(listOf(listOf("sync-1")), deleted)
            assertTrue(failed.isEmpty())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `marks failed messages for retry when upload fails`() = runBlocking {
        val item = message("sync-2", attempts = 2)
        val deleted = mutableListOf<List<String>>()
        val failed = mutableListOf<Pair<List<String>, Long>>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = MessageSyncOutboxQueue(
            scope = scope,
            pendingMessages = { _, _ -> listOf(item) },
            deleteMessages = { deleted += it },
            markMessagesFailed = { ids, nextAttemptAt -> failed += ids to nextAttemptAt },
            syncMessages = { false },
        )

        try {
            queue.flushSerially()
            assertTrue(deleted.isEmpty())
            assertEquals(listOf("sync-2"), failed.single().first)
            assertTrue(failed.single().second > System.currentTimeMillis())
        } finally {
            scope.cancel()
        }
    }

    private fun message(id: String, attempts: Int): MessageSyncOutboxEntity {
        return MessageSyncOutboxEntity(
            id = id,
            token = "token",
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
            role = "user",
            content = "hello",
            source = "sync",
            attempts = attempts,
        )
    }
}
