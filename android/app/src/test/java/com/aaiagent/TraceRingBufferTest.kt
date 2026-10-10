package com.aaiagent

import com.aaiagent.engine.observability.AutomationEvent
import com.aaiagent.engine.observability.TraceRingBuffer
import org.junit.Assert.assertEquals
import org.junit.Test

class TraceRingBufferTest {
    @Test
    fun `keeps only the newest events within capacity`() {
        val buffer = TraceRingBuffer(capacity = 3)
        (1..5).forEach { index ->
            buffer.add(AutomationEvent(eventId = "event-$index", timestampMs = index.toLong()))
        }

        assertEquals(3, buffer.size())
        assertEquals(listOf("event-3", "event-4", "event-5"), buffer.snapshot().map { it.eventId })
    }

    @Test
    fun `can return only events since a timestamp`() {
        val buffer = TraceRingBuffer(capacity = 10)
        buffer.add(AutomationEvent(eventId = "old", timestampMs = 100L))
        buffer.add(AutomationEvent(eventId = "new", timestampMs = 300L))

        assertEquals(listOf("new"), buffer.snapshotSince(200L).map { it.eventId })
    }
}
