package com.aaiagent

import com.aaiagent.engine.BackendReplyTaskPoller
import com.aaiagent.network.ReplyTask
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class BackendReplyTaskPollerTest {
    @Test
    fun `does not request without a device key`() = runBlocking {
        val tokenRead = AtomicBoolean(false)
        val fetchCount = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val poller = BackendReplyTaskPoller(
            scope = scope,
            activeToken = {
                tokenRead.set(true)
                null
            },
            currentPlatform = { "soul" },
            canAcceptTask = { true },
            fetchTask = { _, _ ->
                fetchCount.incrementAndGet()
                task()
            },
        )

        try {
            poller.schedule("lease-1")
            withTimeout(2_000) {
                while (!tokenRead.get()) delay(10)
            }
            delay(50)
            assertEquals(0, fetchCount.get())
            assertNull(poller.nextTask())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `does not enqueue when hosting no longer owns the task`() = runBlocking {
        val fetchCount = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val poller = BackendReplyTaskPoller(
            scope = scope,
            activeToken = { "token-1" },
            currentPlatform = { "soul" },
            canAcceptTask = { false },
            fetchTask = { _, _ ->
                fetchCount.incrementAndGet()
                task()
            },
        )

        try {
            poller.schedule("lease-1")
            withTimeout(2_000) {
                while (fetchCount.get() == 0) delay(10)
            }
            delay(50)
            assertEquals(1, fetchCount.get())
            assertNull(poller.nextTask())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `enqueues one task when hosting owns the lease`() = runBlocking {
        val fetchCount = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val poller = BackendReplyTaskPoller(
            scope = scope,
            activeToken = { " token-1 " },
            currentPlatform = { "soul" },
            canAcceptTask = { it == "lease-1" },
            fetchTask = { token, platform ->
                assertEquals("token-1", token)
                assertEquals("soul", platform)
                fetchCount.incrementAndGet()
                task()
            },
        )

        try {
            poller.schedule("lease-1")
            poller.schedule("lease-1")
            val received = withTimeout(2_000) {
                var value = poller.nextTask()
                while (value == null) {
                    delay(10)
                    value = poller.nextTask()
                }
                value
            }
            assertEquals("task-1", received.taskId)
            assertEquals(1, fetchCount.get())
            assertNull(poller.nextTask())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `clear cancels polling and drops queued tasks`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val poller = BackendReplyTaskPoller(
            scope = scope,
            activeToken = { "token-1" },
            currentPlatform = { "soul" },
            canAcceptTask = { true },
            fetchTask = { _, _ -> task() },
        )

        try {
            poller.schedule("lease-1")
            withTimeout(2_000) {
                var value = poller.nextTask()
                while (value == null) {
                    delay(10)
                    value = poller.nextTask()
                }
            }
            poller.clear()
            assertNull(poller.nextTask())
        } finally {
            scope.cancel()
        }
    }

    private fun task(): ReplyTask {
        return ReplyTask(
            type = "manual",
            taskId = "task-1",
            groupId = null,
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
            content = "hello",
        )
    }
}
