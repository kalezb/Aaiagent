package com.aaiagent

import com.aaiagent.engine.StickerMatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StickerMatcherTest {
    @Test
    fun `all interaction stickers have model-readable meanings`() {
        val expectedMeanings = mapOf(
            "戳一下" to "打招呼",
            "拍一下" to "拍了拍你",
            "弹一下" to "引起你的注意",
            "皮一下" to "开玩笑",
            "挠一下" to "调侃",
            "摸一下" to "安慰",
            "在干嘛" to "开启聊天",
            "YYDS" to "夸赞",
            "加油鸭" to "加油鼓励",
            "奈斯奈斯" to "赞同",
            "用力抱住" to "拥抱",
            "举手dd" to "举手报到",
            "为你打Call" to "应援打Call",
            "哈哈哈" to "被逗笑",
            "略略略" to "开玩笑"
        )

        assertEquals(15, expectedMeanings.size)
        expectedMeanings.forEach { (name, meaning) ->
            val text = StickerMatcher.modelTextFor(name)
            assertNotNull(text)
            assertTrue(text!!.contains("「$name」"))
            assertTrue(text.contains(meaning))
        }
    }

    @Test
    fun `unknown interaction sticker has no invented meaning`() {
        assertNull(StickerMatcher.modelTextFor("未知表情"))
    }

    @Test
    fun `quick game icon match requires a strong and unambiguous image match`() {
        assertTrue(StickerMatcher.isConfidentQuickMatch(14, 42.6, 27, 90.4))
        assertFalse(StickerMatcher.isConfidentQuickMatch(14, 42.6, 16, 45.0))
        assertFalse(StickerMatcher.isConfidentQuickMatch(30, 42.6, 44, 90.4))
    }

    @Test
    fun `interaction sticker template match requires high confidence and unambiguous difference`() {
        // 非常接近（<= 10.0）属于高置信度强匹配
        assertTrue(StickerMatcher.isConfidentTemplateMatch(bestDist = 8.0, secondDist = 9.0))
        // 距离适中且与第二名有充分差距（gap >= 2.5）确认匹配
        assertTrue(StickerMatcher.isConfidentTemplateMatch(bestDist = 14.0, secondDist = 18.0))
        // 差异过小（gap < 2.5），存在歧义，拒绝硬猜
        assertFalse(StickerMatcher.isConfidentTemplateMatch(bestDist = 14.0, secondDist = 15.0))
        // 距离过大（> 20.0），完全不匹配
        assertFalse(StickerMatcher.isConfidentTemplateMatch(bestDist = 22.0, secondDist = 30.0))
    }
}
