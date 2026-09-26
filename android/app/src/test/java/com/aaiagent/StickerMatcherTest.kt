package com.aaiagent

import com.aaiagent.engine.StickerMatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StickerMatcherTest {
    @Test
    fun `all fourteen interaction stickers have model-readable meanings`() {
        val expectedMeanings = mapOf(
            "戳一下" to "打招呼",
            "拍一下" to "拍了拍你",
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

        assertEquals(14, expectedMeanings.size)
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
}
