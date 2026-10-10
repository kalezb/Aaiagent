package com.aaiagent

import com.aaiagent.engine.SelfVoiceMemory
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "记住我这条语音说了什么"的配对规则。
 *
 * 最要紧的两条：**时长对不上时必须宁可空着**（不能张冠李戴把别的话套上去），
 * 以及**重复读同一段聊天结果必须一致**（每轮读消息都会重跑一遍）。
 */
class SelfVoiceMemoryTest {

    private val contact = "期待下一步的我们"

    @After
    fun tearDown() {
        SelfVoiceMemory.clear()
    }

    @Test
    fun `matches what each self voice said by its duration`() {
        SelfVoiceMemory.remember(contact, 6, "在的呀，我今天不忙，有时间陪你聊天。", 1_000L)
        assertEquals(
            listOf("在的呀，我今天不忙，有时间陪你聊天。"),
            SelfVoiceMemory.match(contact, listOf(6))
        )
    }

    @Test
    fun `duration that matches nothing yields null instead of the wrong words`() {
        SelfVoiceMemory.remember(contact, 6, "在的呀", 1_000L)
        // 时长对不上 -> 宁可显示 [语音]，也不能把别的话套到这条语音头上。
        assertEquals(listOf<String?>(null), SelfVoiceMemory.match(contact, listOf(21)))
    }

    @Test
    fun `matching is idempotent so re-reading the same chat gives the same result`() {
        SelfVoiceMemory.remember(contact, 6, "第一句", 1_000L)
        SelfVoiceMemory.remember(contact, 21, "第二句", 2_000L)
        val first = SelfVoiceMemory.match(contact, listOf(6, 21))
        val second = SelfVoiceMemory.match(contact, listOf(6, 21))
        assertEquals(listOf("第一句", "第二句"), first)
        assertEquals(first, second)
    }

    @Test
    fun `same duration twice is handed out in the order it was sent`() {
        SelfVoiceMemory.remember(contact, 6, "先说的", 1_000L)
        SelfVoiceMemory.remember(contact, 6, "后说的", 2_000L)
        assertEquals(listOf("先说的", "后说的"), SelfVoiceMemory.match(contact, listOf(6, 6)))
    }

    @Test
    fun `a voice the agent did not send keeps the placeholder instead of stealing new words`() {
        // 只有最新那条是 AiaAgent 发的（手动发的记不住内容）。
        // 从最新往回配，旧的那条应该留在 [语音]，绝不能把新说的话套到它头上。
        // （真机 2026-10-06 07:09：两条同为 6 秒的语音里，文本错挂到了较早那条。）
        SelfVoiceMemory.remember(contact, 6, "新说的话", 2_000L)
        assertEquals(
            listOf<String?>(null, "新说的话"),
            SelfVoiceMemory.match(contact, listOf(6, 6))
        )
    }

    @Test
    fun `each conversation keeps its own memory`() {
        SelfVoiceMemory.remember(contact, 6, "给她的", 1_000L)
        assertEquals(listOf<String?>(null), SelfVoiceMemory.match("别人", listOf(6)))
    }

    @Test
    fun `unreadable duration is never matched`() {
        SelfVoiceMemory.remember(contact, 6, "在的呀", 1_000L)
        assertEquals(listOf<String?>(null), SelfVoiceMemory.match(contact, listOf(0)))
    }

    @Test
    fun `nonsensical input is ignored`() {
        SelfVoiceMemory.remember(contact, 0, "没有时长", 1_000L)
        SelfVoiceMemory.remember(contact, 6, "   ", 1_000L)
        SelfVoiceMemory.remember("", 6, "没有会话", 1_000L)
        assertEquals(0, SelfVoiceMemory.size(contact))
    }

    @Test
    fun `memory per conversation is bounded`() {
        repeat(40) { i -> SelfVoiceMemory.remember(contact, 6, "第 $i 句", i.toLong()) }
        assertEquals(30, SelfVoiceMemory.size(contact))
        // 最老的 10 条被丢掉，只剩 第 10 句 .. 第 39 句。
        // 配对是从最新往回配：孤零零一条气泡拿到的应该是最新记下的那句。
        assertEquals(listOf("第 39 句"), SelfVoiceMemory.match(contact, listOf(6)))
    }

    @Test
    fun `forget only drops the conversation it was given`() {
        SelfVoiceMemory.remember(contact, 6, "给她的", 1_000L)
        SelfVoiceMemory.remember("别人", 6, "给别人的", 1_000L)
        SelfVoiceMemory.forget(contact)
        assertEquals(listOf<String?>(null), SelfVoiceMemory.match(contact, listOf(6)))
        assertEquals(listOf("给别人的"), SelfVoiceMemory.match("别人", listOf(6)))
    }
}
