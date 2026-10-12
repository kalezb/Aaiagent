package com.aaiagent

import com.aaiagent.adapter.SoulStickerPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulStickerPolicyTest {

    @Test
    fun `layer 1 extracts official label from accessibility contentDescription`() {
        // 平台官方标注，准确率 100%
        assertEquals("早上好", SoulStickerPolicy.extractLabelFromDescription("早上好"))
        assertEquals("抱抱", SoulStickerPolicy.extractLabelFromDescription("[抱抱]"))
        assertEquals("抱抱", SoulStickerPolicy.extractLabelFromDescription("【抱抱】"))
        assertEquals("点赞", SoulStickerPolicy.extractLabelFromDescription("表情: 点赞"))
        assertEquals("点赞", SoulStickerPolicy.extractLabelFromDescription("表情包: 点赞"))
        assertEquals("开心", SoulStickerPolicy.extractLabelFromDescription("互动表情: 开心"))
        assertEquals("害羞", SoulStickerPolicy.extractLabelFromDescription("Soul表情: 害羞"))

        // 通用占位符不作为具体标签
        assertNull(SoulStickerPolicy.extractLabelFromDescription("表情"))
        assertNull(SoulStickerPolicy.extractLabelFromDescription("表情包"))
        assertNull(SoulStickerPolicy.extractLabelFromDescription("图片"))
        assertNull(SoulStickerPolicy.extractLabelFromDescription("语音"))
        assertNull(SoulStickerPolicy.extractLabelFromDescription(null))
        assertNull(SoulStickerPolicy.extractLabelFromDescription(""))
    }

    @Test
    fun `layer 1 resolved official label produces precise model description`() {
        val resolved = SoulStickerPolicy.resolveFromDescription("抱抱")
        assertNotNull(resolved)
        assertTrue(resolved!!.contains("「抱抱」"))
        assertTrue(resolved.contains("官方表情"))
    }

    @Test
    fun `layer 2 calculates time of day greeting across all time periods without guessing`() {
        // 早（5:00 - 11:59）
        assertEquals("早安", SoulStickerPolicy.resolveTimeGreeting(5))
        assertEquals("早安", SoulStickerPolicy.resolveTimeGreeting(8))
        assertEquals("早安", SoulStickerPolicy.resolveTimeGreeting(11))

        // 中（12:00 - 17:59）
        assertEquals("午安", SoulStickerPolicy.resolveTimeGreeting(12))
        assertEquals("午安", SoulStickerPolicy.resolveTimeGreeting(14))
        assertEquals("午安", SoulStickerPolicy.resolveTimeGreeting(17))

        // 晚（18:00 - 04:59）
        assertEquals("晚安", SoulStickerPolicy.resolveTimeGreeting(18))
        assertEquals("晚安", SoulStickerPolicy.resolveTimeGreeting(22))
        assertEquals("晚安", SoulStickerPolicy.resolveTimeGreeting(23))
        assertEquals("晚安", SoulStickerPolicy.resolveTimeGreeting(0))
        assertEquals("晚安", SoulStickerPolicy.resolveTimeGreeting(3))
    }

    @Test
    fun `layer 2 time-sensitive stickers adapt to current time period`() {
        val morningText = SoulStickerPolicy.resolveFromDescription("时段表情", currentHour = 9)
        assertNotNull(morningText)
        assertTrue(morningText!!.contains("「早安」"))

        val afternoonText = SoulStickerPolicy.resolveFromDescription("时段表情", currentHour = 15)
        assertNotNull(afternoonText)
        assertTrue(afternoonText!!.contains("「午安」"))

        val nightText = SoulStickerPolicy.resolveFromDescription("问候", currentHour = 21)
        assertNotNull(nightText)
        assertTrue(nightText!!.contains("「晚安」"))
    }

    @Test
    fun `layer 4 safe fallback text prevents wild hallucinations`() {
        assertEquals("对方发来一个友好互动表情", SoulStickerPolicy.safeFallbackModelText())
        assertEquals("对方发来一个友好互动表情", SoulStickerPolicy.SAFE_FALLBACK_TEXT)
    }
}
