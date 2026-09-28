package com.aaiagent

import com.aaiagent.adapter.SoulInteractionPreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulInteractionPreviewTest {
    @Test
    fun `bracketed morning greeting is preserved from conversation preview`() {
        assertEquals("早上好", SoulInteractionPreview.resolve("[早上好]"))
    }

    @Test
    fun `full width brackets are supported`() {
        assertEquals("晚上好", SoulInteractionPreview.resolve("【晚上好】"))
    }

    @Test
    fun `generic image preview is not treated as a greeting`() {
        assertNull(SoulInteractionPreview.resolve("[图片]"))
    }

    @Test
    fun `ordinary text is not treated as an interaction label`() {
        assertNull(SoulInteractionPreview.resolve("普通文字"))
    }

    @Test
    fun `model text does not depend on the time the message is opened`() {
        val text = SoulInteractionPreview.modelTextFor("早上好")
        assertTrue(text.contains("早上好"))
        assertTrue(text.contains("消息列表明确标注"))
        assertTrue(text.contains("不受当前查看时间影响"))
    }
}
