package com.aaiagent

import com.aaiagent.engine.VoiceEmotionMemory
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * 跨轮情绪记忆的存放规则。
 *
 * 这是"情绪连成一条轨迹"的落地点：记错了会导致情绪串台（把 A 的委屈带到 B 身上）。
 */
class VoiceEmotionMemoryTest {

    @Before
    fun setUp() {
        VoiceEmotionMemory.clear()
    }

    @After
    fun tearDown() {
        VoiceEmotionMemory.clear()
    }

    @Test
    fun `state is kept per conversation`() {
        VoiceEmotionMemory.remember("soul:A", "{\"primary\":\"hurt\"}")
        VoiceEmotionMemory.remember("soul:B", "{\"primary\":\"happy\"}")
        assertEquals("{\"primary\":\"hurt\"}", VoiceEmotionMemory.previous("soul:A"))
        assertEquals("{\"primary\":\"happy\"}", VoiceEmotionMemory.previous("soul:B"))
    }

    @Test
    fun `an unknown conversation has no state`() {
        assertNull(VoiceEmotionMemory.previous("soul:从没见过"))
    }

    @Test
    fun `blank keys or values are ignored instead of stored`() {
        VoiceEmotionMemory.remember("", "{}")
        VoiceEmotionMemory.remember("   ", "{}")
        VoiceEmotionMemory.remember("soul:A", null)
        VoiceEmotionMemory.remember("soul:A", "   ")
        assertEquals(0, VoiceEmotionMemory.size())
        assertNull(VoiceEmotionMemory.previous("soul:A"))
    }

    @Test
    fun `keys are trimmed so the same conversation cannot split in two`() {
        VoiceEmotionMemory.remember("  soul:A  ", "{\"x\":1}")
        assertEquals("{\"x\":1}", VoiceEmotionMemory.previous("soul:A"))
        assertEquals(1, VoiceEmotionMemory.size())
    }

    @Test
    fun `remembering again replaces the older state`() {
        VoiceEmotionMemory.remember("soul:A", "{\"old\":true}")
        VoiceEmotionMemory.remember("soul:A", "{\"new\":true}")
        assertEquals("{\"new\":true}", VoiceEmotionMemory.previous("soul:A"))
        assertEquals(1, VoiceEmotionMemory.size())
    }

    @Test
    fun `forget drops one conversation and leaves the rest`() {
        VoiceEmotionMemory.remember("soul:A", "{}")
        VoiceEmotionMemory.remember("soul:B", "{}")
        VoiceEmotionMemory.forget("soul:A")
        assertNull(VoiceEmotionMemory.previous("soul:A"))
        assertEquals("{}", VoiceEmotionMemory.previous("soul:B"))
    }

    @Test
    fun `the number of conversations is bounded`() {
        // 会话一多不能无限涨 —— 内存里放的东西必须有上限。
        for (index in 0 until 200) {
            VoiceEmotionMemory.remember("soul:$index", "{\"i\":$index}")
        }
        assertEquals(true, VoiceEmotionMemory.size() in 1..60)
        // 最近写的那个一定还在
        assertEquals("{\"i\":199}", VoiceEmotionMemory.previous("soul:199"))
    }
}
