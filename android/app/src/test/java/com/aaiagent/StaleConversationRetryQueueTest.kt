package com.aaiagent

import com.aaiagent.engine.StaleConversationRetryQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StaleConversationRetryQueueTest {
    @Test
    fun `restores an overdue conversation for immediate retry`() {
        val queue = StaleConversationRetryQueue(now = { 1_000L })

        queue.restore(
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
            dueAtMs = 1_000L,
        )

        val retry = queue.takeDue("soul", 1_000L)
        assertEquals("contact-1", retry?.contactId)
        assertEquals(0, retry?.attempts)
        assertNull(queue.takeDue("soul", 1_000L))
    }

    @Test
    fun `does not take a retry before it is due or for another platform`() {
        val queue = StaleConversationRetryQueue(now = { 1_000L })
        queue.enqueue(
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
            delayMs = 350L,
            maxAttempts = 3,
        )

        assertNull(queue.takeDue("soul", 1_349L))
        assertNull(queue.takeDue("qq", 1_350L))
        assertEquals("contact-1", queue.takeDue("soul", 1_350L)?.contactId)
    }

    @Test
    fun `drops the retry after the last allowed attempt`() {
        val queue = StaleConversationRetryQueue(now = { 1_000L })

        assertEquals(
            1,
            queue.enqueue("soul", "contact-1", "梦想", 0L, maxAttempts = 1),
        )
        assertEquals(
            2,
            queue.enqueue("soul", "contact-1", "梦想", 0L, maxAttempts = 1),
        )
        assertNull(queue.takeDue("soul", 1_000L))
    }

    @Test
    fun `in-flight work can be rescheduled or cleared`() {
        val queue = StaleConversationRetryQueue(now = { 1_000L })
        queue.restore("soul", "contact-1", "梦想", dueAtMs = 1_000L)
        val retry = queue.takeDue("soul", 1_000L)!!

        queue.reschedule(retry, delayMs = 350L)
        assertNull(queue.takeDue("soul", 1_349L))
        val rescheduled = queue.takeDue("soul", 1_350L)!!
        queue.clearInFlight(rescheduled)
        assertNull(queue.takeDue("soul", 2_000L))
        assertEquals(0, queue.pendingCount())
    }

    @Test
    fun `clear removes every waiting conversation`() {
        val queue = StaleConversationRetryQueue(now = { 1_000L })
        queue.restore("soul", "contact-1", "梦想", dueAtMs = 1_000L)
        queue.restore("soul", "contact-2", "小夏", dueAtMs = 1_000L)

        queue.clear()

        assertEquals(0, queue.pendingCount())
        assertNull(queue.takeDue("soul", 1_000L))
    }
}
