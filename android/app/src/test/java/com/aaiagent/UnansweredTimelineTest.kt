package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.UnansweredTimeline
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UnansweredTimelineTest {
    @Test
    fun `single incoming message does not need a timeline`() {
        val timeline = UnansweredTimeline.build(
            listOf(ChatMessage("other", "在吗", "text", "今天 10:00"))
        )

        assertNull(timeline)
    }

    @Test
    fun `multi message unanswered episode explains chronology and media meaning`() {
        val base = 1_800_000_000_000L
        val messages = listOf(
            ChatMessage("other", "最近怎么不说话了", "text", "9月25日 22:10", base),
            ChatMessage("other", "对方转发了你的动态", "moment_card", "9月26日 18:30", base + 20 * 60 * 60 * 1000L),
            ChatMessage(
                "other",
                "对方发来 Soul 互动表情「皮一下」：对方和你开玩笑，气氛轻松调皮",
                "text",
                "9月27日 10:20",
                base + 36 * 60 * 60 * 1000L
            )
        )

        val timeline = UnansweredTimeline.build(messages, nowMillis = base + 40 * 60 * 60 * 1000L)!!

        assertTrue(timeline.contains("跨时间连续发来的同一轮未回复消息"))
        assertTrue(timeline.contains("【9月25日 22:10】最近怎么不说话了"))
        assertTrue(timeline.contains("【9月26日 18:30】分享动态：对方转发了你的动态"))
        assertTrue(timeline.contains("互动表情：对方发来 Soul 互动表情「皮一下」"))
        assertTrue(timeline.contains("不要逐条机械回复"))
    }

    @Test
    fun `two recent messages still use the compact timeline`() {
        val messages = listOf(
            ChatMessage("other", "在吗", "text", "今天 10:00"),
            ChatMessage("other", "人呢", "text", "今天 10:03")
        )

        assertTrue(UnansweredTimeline.build(messages)!!.contains("同一轮未回复消息"))
    }
}
