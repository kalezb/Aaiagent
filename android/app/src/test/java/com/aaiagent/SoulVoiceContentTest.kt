package com.aaiagent

import com.aaiagent.adapter.SoulVoiceContent
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 语音消息的内容怎么渲染给大模型看。
 *
 * **对方发的那条路一个字都不能变**（现有读消息逻辑全靠它）；
 * **自己发的那条路**要能带上当时说的话，而且绝不能标成"对方"说的。
 */
class SoulVoiceContentTest {

    // ---- 对方发的：必须和改动前一模一样 ----

    @Test
    fun `incoming voice keeps the original prefix and wording`() {
        assertEquals(
            "对方语音转文字：今天天气特别冷",
            SoulVoiceContent.resolveIncoming("今天天气特别冷", "")
        )
        assertEquals(
            "对方语音转文字：今天天气特别冷 你那边呢",
            SoulVoiceContent.resolveIncoming("今天天气特别冷", "你那边呢")
        )
        assertEquals("只有文字说明", SoulVoiceContent.resolveIncoming("", "只有文字说明"))
        assertEquals(SoulVoiceContent.PLACEHOLDER, SoulVoiceContent.resolveIncoming("", ""))
    }

    @Test
    fun `legacy resolve still behaves exactly like the incoming path`() {
        // 老调用点还在（SoulMediaTypeTest 也直接测它），行为不能变。
        assertEquals(
            SoulVoiceContent.resolveIncoming("今天天气特别冷", "你那边呢"),
            SoulVoiceContent.resolve("今天天气特别冷", "你那边呢")
        )
        assertEquals(SoulVoiceContent.PLACEHOLDER, SoulVoiceContent.resolve("", ""))
    }

    // ---- 自己发的：补上当时说的话 ----

    @Test
    fun `outgoing voice shows what was actually said`() {
        assertEquals(
            "[语音] 在的呀，我今天不忙，有时间陪你聊天。",
            SoulVoiceContent.resolveOutgoing("在的呀，我今天不忙，有时间陪你聊天。", "")
        )
    }

    @Test
    fun `outgoing voice never claims to be the other side`() {
        val rendered = SoulVoiceContent.resolveOutgoing("在的呀", "")
        assertEquals(false, rendered.contains("对方"))
    }

    @Test
    fun `outgoing voice without remembered words falls back to the placeholder`() {
        assertEquals(SoulVoiceContent.PLACEHOLDER, SoulVoiceContent.resolveOutgoing(null, ""))
        assertEquals(SoulVoiceContent.PLACEHOLDER, SoulVoiceContent.resolveOutgoing("   ", ""))
    }

    @Test
    fun `outgoing voice keeps a text caption when there is one`() {
        assertEquals(
            "[语音] 在的呀 顺带说一句",
            SoulVoiceContent.resolveOutgoing("在的呀", "顺带说一句")
        )
    }

    /**
     * 这个字符串是"自己发的语音"的**编号锚点**（SoulMessageIdentity 拿它算编号）。
     * 一旦改成带文字的形式，同一条语音的编号就会变、上下文里会重复出现。
     */
    @Test
    fun `placeholder is a frozen constant`() {
        assertEquals("[语音]", SoulVoiceContent.PLACEHOLDER)
    }

    // ---- 编号锚点：不论方向，语音都要稳 ----

    /**
     * **这是 2026-10-06 那次事故的核心不变式。**
     *
     * 对方语音的编号原来用的是"转写后的内容" —— 转写一出现编号就变，
     * 同一条语音被当成另一条新消息，去重/批次挑选/来源归属全乱，
     * 最后大模型收到的是空内容，回了句"再说一遍呀，想听你说"。
     */
    @Test
    fun `voice identity does not change when the transcription appears`() {
        val before = SoulVoiceContent.resolveIncoming("", "")
        val after = SoulVoiceContent.resolveIncoming("今天天气特别冷", "")
        assertEquals(true, before != after) // 内容确实变了（大模型要看得到）

        // 但编号锚点必须一样 —— 转写前后是同一条语音。
        assertEquals(
            SoulVoiceContent.identityAnchor(isVoice = true, content = before),
            SoulVoiceContent.identityAnchor(isVoice = true, content = after)
        )
        assertEquals("[语音]", SoulVoiceContent.identityAnchor(isVoice = true, content = after))
    }

    @Test
    fun `voice identity is the same for both directions`() {
        // 来源由编号的 sender 那一段负责，锚点只认"是语音"。
        assertEquals(
            SoulVoiceContent.identityAnchor(isVoice = true, content = "对方语音转文字：在的"),
            SoulVoiceContent.identityAnchor(isVoice = true, content = "[语音] 我说的")
        )
    }

    @Test
    fun `non voice identity still uses the real content`() {
        // 文字/表情这些内容本身就是稳定的，必须继续用真内容区分不同消息。
        assertEquals("在的呀", SoulVoiceContent.identityAnchor(isVoice = false, content = "在的呀"))
        assertEquals("[表情]", SoulVoiceContent.identityAnchor(isVoice = false, content = "[表情]"))
        assertEquals("[图片]", SoulVoiceContent.identityAnchor(isVoice = false, content = "[图片]"))
    }

    @Test
    fun `incoming voice content still proves it came from the other side`() {
        // 锚点里没有方向，内容里必须有 —— 否则大模型分不清是谁说的。
        val rendered = SoulVoiceContent.resolveIncoming("今天天气特别冷", "")
        assertEquals(true, rendered.startsWith("对方语音转文字："))
        assertEquals(false, rendered.contains("[语音]"))
    }
}
