package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.SoulConversationTimePolicy
import com.aaiagent.engine.SoulMessageTime
import com.aaiagent.engine.SyncTimePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class SoulConversationTimePolicyTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val nowMs = ZonedDateTime.of(2026, 10, 17, 9, 40, 0, 0, zone)
        .toInstant()
        .toEpochMilli()

    @Test
    fun `only the message with its own timestamp is trusted`() {
        val tracker = SoulMessageTime.ContextTracker { nowMs }

        val first = tracker.observe("09:34")
        val second = tracker.observe("")
        val third = tracker.observe("")

        assertTrue(first.explicit)
        assertEquals("09:34", first.text)
        assertFalse(second.explicit)
        assertFalse(third.explicit)
        assertEquals("", second.text)
        assertEquals(first.epochMillis!! + 1_000L, second.epochMillis)
        assertEquals(first.epochMillis!! + 2_000L, third.epochMillis)
    }

    @Test
    fun `inbox time replaces an inherited group time for the latest incoming message`() {
        val messages = nightConversation()

        val merged = SoulConversationTimePolicy.fuseLatestFromInbox(
            messages = messages,
            listPreview = "还在躺着呢",
            listTimeText = "09:37",
            nowMs = nowMs,
        )

        val latest = merged.last()
        val expected = ZonedDateTime.of(2026, 10, 17, 9, 37, 0, 0, zone)
            .toInstant()
            .toEpochMilli()
        assertTrue(latest.timestampTrusted)
        assertEquals(expected, latest.timestampMillis)
        assertEquals("09:37", latest.timestampText)
    }

    @Test
    fun `cloud request times follow app order from the inbox time backwards`() {
        val merged = SoulConversationTimePolicy.fuseLatestFromInbox(
            messages = nightConversation(),
            listPreview = "还在躺着呢",
            listTimeText = "09:37",
            nowMs = nowMs,
        )

        val seconds = SyncTimePolicy.deriveSeconds(
            millisList = merged.map { if (it.timestampTrusted) it.timestampMillis else null },
            nowMs = nowMs,
        )

        assertTrue(seconds.zipWithNext().all { (left, right) -> right > left })
        val expectedLatestSeconds = ZonedDateTime.of(2026, 10, 17, 9, 37, 0, 0, zone)
            .toInstant()
            .epochSecond
        assertEquals(expectedLatestSeconds, seconds.last())
        assertEquals(seconds.last() - 1L, seconds[seconds.lastIndex - 1])
    }

    @Test
    fun `inbox time does not touch a different latest preview`() {
        val messages = nightConversation()

        val merged = SoulConversationTimePolicy.fuseLatestFromInbox(
            messages = messages,
            listPreview = "另一条消息",
            listTimeText = "09:37",
            nowMs = nowMs,
        )

        assertEquals(messages, merged)
        assertFalse(merged.last().timestampTrusted)
    }

    private fun nightConversation(): List<ChatMessage> {
        val firstTime = ZonedDateTime.of(2026, 10, 17, 9, 34, 0, 0, zone)
            .toInstant()
            .toEpochMilli()
        return listOf(
            ChatMessage(
                sender = "other",
                content = "你好",
                timestampText = "09:34",
                timestampMillis = firstTime,
                timestampTrusted = true,
            ),
            ChatMessage(
                sender = "other",
                content = "在忙什么呀？",
                timestampText = "",
                timestampMillis = firstTime + 1_000L,
                timestampTrusted = false,
            ),
            ChatMessage(
                sender = "self",
                content = "上午好呀",
                timestampText = "",
                timestampMillis = firstTime + 2_000L,
                timestampTrusted = false,
            ),
            ChatMessage(
                sender = "self",
                content = "刚歇下来 你呢？",
                timestampText = "",
                timestampMillis = firstTime + 3_000L,
                timestampTrusted = false,
            ),
            ChatMessage(
                sender = "other",
                content = "还在躺着呢",
                timestampText = "",
                timestampMillis = firstTime + 4_000L,
                timestampTrusted = false,
            ),
        )
    }
}
