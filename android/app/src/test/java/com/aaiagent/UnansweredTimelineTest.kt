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
            ChatMessage("other", "你怎么突然想起我了", "text", "9月26日 18:30", base + 20 * 60 * 60 * 1000L),
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
        assertTrue(timeline.contains("【9月26日 18:30】你怎么突然想起我了"))
        assertTrue(timeline.contains("【9月27日 10:20】互动表情：对方发来 Soul 互动表情「皮一下」"))
        assertTrue(timeline.contains("只把最新一句当成本轮起点"))
        assertTrue(timeline.contains("按时间顺序理解"))
        assertTrue(timeline.contains("【待处理事项】"))
        assertTrue(timeline.contains("先处理第1项"))
    }

    @Test
    fun `two recent messages still use the compact timeline`() {
        val messages = listOf(
            ChatMessage("other", "在吗", "text", "今天 10:00"),
            ChatMessage("other", "人呢", "text", "今天 10:03")
        )

        assertTrue(UnansweredTimeline.build(messages)!!.contains("同一轮未回复消息"))
    }

    @Test
    fun `incoming farewell stays raw for the model to interpret`() {
        val messages = listOf(
            ChatMessage("other", "我先去处理点事", "text", "今天 10:00"),
            ChatMessage("other", "洗澡去了 回聊", "text", "今天 10:03")
        )

        val timeline = UnansweredTimeline.build(messages)!!
        assertTrue(timeline.contains("洗澡去了 回聊"))
        assertTrue(!timeline.contains("暂离提示：洗澡去了 回聊"))
    }

    @Test
    fun `timeline does not hard label ordinary farewell wording`() {
        val messages = listOf(
            ChatMessage("other", "你先忙", "text", "今天 10:00"),
            ChatMessage("other", "等你忙完再说", "text", "今天 10:03")
        )

        val timeline = UnansweredTimeline.build(messages)!!
        assertTrue(timeline.contains("你先忙"))
        assertTrue(!timeline.contains("对方暂离："))
        assertTrue(!timeline.contains("暂离提示："))
    }
}
