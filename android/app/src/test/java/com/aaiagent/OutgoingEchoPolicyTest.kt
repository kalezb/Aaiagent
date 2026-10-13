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
}
