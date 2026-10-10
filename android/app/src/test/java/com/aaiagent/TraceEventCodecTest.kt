package com.aaiagent

import com.aaiagent.engine.TraceEvent
import com.aaiagent.engine.TraceEventCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TraceEventCodecTest {
    @Test
    fun `trace event emits one valid json line`() {
        val line = TraceEventCodec.toJsonLine(
            TraceEvent(
                traceId = "turn-1",
                event = "send_segment",
                platform = "soul",
                contactId = "contact-1",
                stage = "sending",
                elapsedMs = 42L,
                result = "success",
            ),
            timestampMs = 1_000L,
        )

        assertTrue(line.startsWith("{\"timestamp_ms\":\"1000\""))
        assertTrue(line.contains("\"trace_id\":\"turn-1\""))
        assertTrue(line.endsWith("}"))
        assertEquals(0, line.count { it == '\n' })
    }

    @Test
    fun `trace event escapes quotes and control characters`() {
        val line = TraceEventCodec.toJsonLine(
            TraceEvent(
                traceId = "a\"b",
                event = "line\nbreak",
                reason = "\\path",
            ),
            timestampMs = 1L,
        )

        assertTrue(line.contains("\\\"b"))
        assertTrue(line.contains("line\\nbreak"))
        assertTrue(line.contains("\\\\path"))
    }
}
