package com.aaiagent

import com.aaiagent.adapter.SoulGameInteraction
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulGameInteractionTest {
    @Test
    fun `billards and cocktail interaction are games`() {
        assertTrue(SoulGameInteraction.isGameLabel("桌球"))
        assertTrue(SoulGameInteraction.isGameLabel("[晚安鸡尾酒]"))
    }

    @Test
    fun `greeting and gift are not games`() {
        assertFalse(SoulGameInteraction.isGameLabel("早上好"))
        assertFalse(SoulGameInteraction.isGameLabel("礼物"))
    }

    @Test
    fun `model text asks for a polite decline and topic change`() {
        val text = SoulGameInteraction.modelTextFor("桌球")
        assertTrue(text.contains("桌球"))
        assertTrue(text.contains("婉拒"))
        assertTrue(text.contains("换回"))
        assertTrue(text.contains("日常话题"))
    }
}
