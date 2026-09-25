package com.aaiagent

import com.aaiagent.engine.SoulMessageTime
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulMessageTimeTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val now = Instant.parse("2026-09-25T00:59:00Z").toEpochMilli()

    @Test
    fun `parses today's clock time`() {
        assertEquals(
            Instant.parse("2026-09-24T22:59:00Z").toEpochMilli(),
            SoulMessageTime.parseToEpochMillis("06:59", now, zone)
        )
    }

    @Test
    fun `parses yesterday and month day labels`() {
        assertEquals(
            Instant.parse("2026-09-23T22:59:00Z").toEpochMilli(),
            SoulMessageTime.parseToEpochMillis("昨天 06:59", now, zone)
        )
        assertEquals(
            Instant.parse("2026-09-21T22:59:00Z").toEpochMilli(),
            SoulMessageTime.parseToEpochMillis("9月22日 06:59", now, zone)
        )
    }

    @Test
    fun `parses numeric dates and rejects unknown labels`() {
        assertEquals(
            Instant.parse("2026-09-21T22:59:00Z").toEpochMilli(),
            SoulMessageTime.parseToEpochMillis("2026-09-22 06:59", now, zone)
        )
        assertNull(SoulMessageTime.parseToEpochMillis("周三", now, zone))
    }

    @Test
    fun `clock time ahead of now is treated as yesterday`() {
        assertEquals(
            Instant.parse("2026-09-24T15:00:00Z").toEpochMilli(),
            SoulMessageTime.parseToEpochMillis("23:00", now, zone)
        )
    }

    @Test
    fun `timestamp context is inherited by following bubbles in the same group`() {
        val tracker = SoulMessageTime.ContextTracker { now }
        val separator = tracker.observe("9月22日 06:59")
        val followingBubble = tracker.observe("")

        assertEquals("9月22日 06:59", followingBubble.text)
        assertEquals(separator.epochMillis, followingBubble.epochMillis)
    }

    @Test
    fun `new timestamp replaces inherited context`() {
        val tracker = SoulMessageTime.ContextTracker { now }
        tracker.observe("9月22日 06:59")
        val current = tracker.observe("刚刚")

        assertEquals("刚刚", current.text)
        assertEquals(now, current.epochMillis)
    }
}
