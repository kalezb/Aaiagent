package com.aaiagent

import com.aaiagent.engine.ConversationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationContextStaleDeliveryTest {
    @Test
    fun `repeated stale attempts pause only the same incoming batch`() {
        val context = ConversationContext("soul", "contact-1")
        val now = 1_000L

        repeat(ConversationContext.STALE_DELIVERY_MAX_FAILURES) {
            context.recordStaleDeliveryFailure("batch-a", now)
        }

        assertTrue(context.shouldSkipPausedStaleDelivery("batch-a", now + 1))
        assertFalse(context.shouldSkipPausedStaleDelivery("batch-b", now + 1))
    }

    @Test
    fun `the failed batch can retry after the pause expires`() {
        val context = ConversationContext("soul", "contact-1")
        val now = 1_000L

        repeat(ConversationContext.STALE_DELIVERY_MAX_FAILURES) {
            context.recordStaleDeliveryFailure("batch-a", now, pauseMs = 500L)
        }

        assertFalse(context.shouldSkipPausedStaleDelivery("batch-a", now + 501L))
    }

    @Test
    fun `a successful send clears the pause`() {
        val context = ConversationContext("soul", "contact-1")
        val now = 1_000L

        repeat(ConversationContext.STALE_DELIVERY_MAX_FAILURES) {
            context.recordStaleDeliveryFailure("batch-a", now)
        }
        context.clearStaleDeliveryFailures()

        assertFalse(context.shouldSkipPausedStaleDelivery("batch-a", now + 1))
        assertEquals(0, context.staleDeliveryFailureCount)
    }
}
