package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.OutgoingEchoPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OutgoingEchoPolicyTest {
    @Test
    fun `identical reply already in the last outgoing messages is treated as sent`() {
        // 真机：第一次其实发出去了，只是没验证到，几秒后待处理回复又发一遍 → 重复。
        assertTrue(
            OutgoingEchoPolicy.alreadyJustSent(
                text = "在家窝着哪无聊了 我巴不得呢",
                recentSelfMessages = listOf("那明天打算干嘛呀", "在家窝着哪无聊了 我巴不得呢"),
            )
        )
        // 空格差异也算同一句
        assertTrue(
            OutgoingEchoPolicy.alreadyJustSent(
                text = "在家窝着哪无聊了 我巴不得呢",
                recentSelfMessages = listOf("在家窝着哪无聊了  我巴不得呢"),
            )
        )
    }

    @Test
    fun `an older identical line does not block a new reply`() {
        // 只看最近两条：更早说过同一句，不该拦住现在这句正常的回复。
        assertFalse(
            OutgoingEchoPolicy.alreadyJustSent(
                text = "在的 刚忙完",
                recentSelfMessages = listOf("在的 刚忙完", "怎么了", "你说"),
            )
        )
    }

    @Test
    fun `a different or empty reply is never skipped`() {
        assertFalse(
            OutgoingEchoPolicy.alreadyJustSent(
                text = "这就困啦 才几点",
                recentSelfMessages = listOf("我也没睡着 躺着刷手机呢"),
            )
        )
        assertFalse(OutgoingEchoPolicy.alreadyJustSent(text = "", recentSelfMessages = listOf("随便")))
    }

    @Test
    fun `central send gate only checks recent outgoing chat bubbles`() {
        val visibleMessages = listOf(
            ChatMessage(sender = "self", content = "很早以前说过的话"),
            ChatMessage(sender = "peer", content = "后面聊别的了"),
            ChatMessage(sender = "self", content = "在的 刚忙完"),
            ChatMessage(sender = "peer", content = "怎么不说话"),
            ChatMessage(sender = "self", content = "这会儿在忙"),
        )

        assertTrue(
            OutgoingEchoPolicy.shouldSkipSend(
                text = " 这会儿在忙 ",
                visibleMessages = visibleMessages,
            )
        )
        assertFalse(
            OutgoingEchoPolicy.shouldSkipSend(
                text = "很早以前说过的话",
                visibleMessages = visibleMessages,
            )
        )
    }

    @Test
    fun `the same line said minutes ago must still be sent after the peer replies`() {
        // 2026-11-03 真机（00:17，小张晨）：模型把三分钟前的“嘴上这么甜”又说了一遍。
        // 对方已经接了话，这就是新的一轮，必须真发出去，不能当成我们自己的回声吞掉。
        val visibleMessages = listOf(
            ChatMessage(sender = "self", content = "嘴上这么甜"),
            ChatMessage(sender = "self", content = "才刚认识呢"),
            ChatMessage(sender = "peer", content = "小姐姐呀也没睡呀"),
        )

        assertFalse(
            OutgoingEchoPolicy.shouldSkipSend(
                text = "嘴上这么甜",
                visibleMessages = visibleMessages,
            )
        )
    }

    @Test
    fun `a bubble that is still the newest message is treated as our own echo`() {
        // 真机：发出去以后没有验证到，几秒后重发一次。这时对方还没接话，属于回声，跳过。
        val visibleMessages = listOf(
            ChatMessage(sender = "peer", content = "在干嘛"),
            ChatMessage(sender = "self", content = "刚哄完娃呢"),
        )

        assertTrue(
            OutgoingEchoPolicy.shouldSkipSend(
                text = "刚哄完娃呢",
                visibleMessages = visibleMessages,
            )
        )
    }
}
