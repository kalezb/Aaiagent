package com.aaiagent

import com.aaiagent.engine.UndetectedOwnBubblePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UndetectedOwnBubblePolicyTest {
    private val sent = setOf("你好呀", "刚在忙，回晚了")

    @Test
    fun `bubble matching our own sent text is never treated as incoming`() {
        assertTrue(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "你好呀",
                sentByAutomation = sent,
            )
        )
        assertTrue(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = " 刚在忙，回晚了 ",
                sentByAutomation = sent,
            )
        )
    }

    @Test
    fun `a slice of our own longer message is recognised as ours`() {
        // 真机原样：她发的是三段长消息，平台读回来的只是其中一截。
        val longSent = setOf("企鹅我看到了 就是不太方便加呢|||这边聊着不挺好 你急什么呀|||想看我 那得先说说你拿什么换")
        assertTrue(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "想看我 那得先说说你拿什么换",
                sentByAutomation = longSent,
            )
        )
        assertTrue(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "企鹅我看到了",
                sentByAutomation = longSent,
            )
        )
    }

    @Test
    fun `short unrelated text is not mistaken for ours`() {
        // 只是几个字碰巧一样，不能当成自己发的
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "你好",
                sentByAutomation = setOf("你也好呀 这么晚还醒着"),
            )
        )
    }

    @Test
    fun `genuine incoming text is still answered`() {
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "在干嘛呢",
                sentByAutomation = sent,
            )
        )
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "你好呀",
                sentByAutomation = emptySet(),
            )
        )
    }

    @Test
    fun `resolved self bubbles and media bubbles stay untouched`() {
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "self",
                type = "text",
                content = "你好呀",
                sentByAutomation = sent,
            )
        )
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "sticker",
                content = "你好呀",
                sentByAutomation = sent,
            )
        )
        assertFalse(
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = "other",
                type = "text",
                content = "   ",
                sentByAutomation = sent,
            )
        )
    }

    @Test
    fun `short messages from the contact are never swallowed as ours`() {
        // 2026-10-07 真机（行者）：他的“27”“当然”“我上的是夜班”被当成她自己说过的话，
        // 结果整个会话被判“无需回复”，引擎看一眼就退出去。
        val sent = setOf("当然是骗你的呀", "我上的是夜班呢", "27号我不一定有空")
        for (text in listOf("当然", "27", "夜班")) {
            assertFalse(
                "短消息不该被吞：" + text,
                UndetectedOwnBubblePolicy.isOwnBubble(
                    sender = "other",
                    type = "text",
                    content = text,
                    sentByAutomation = sent,
                )
            )
        }
    }
}
