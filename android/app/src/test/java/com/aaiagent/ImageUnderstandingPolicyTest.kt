package com.aaiagent

import com.aaiagent.engine.ImageUnderstandingPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageUnderstandingPolicyTest {
    @Test
    fun `vision prompt asks for visible age and appearance`() {
        assertTrue(ImageUnderstandingPolicy.VISION_PROMPT.contains("儿童"))
        assertTrue(ImageUnderstandingPolicy.VISION_PROMPT.contains("外貌"))
        assertFalse(ImageUnderstandingPolicy.VISION_PROMPT.contains("不要猜测人物关系"))
    }

    @Test
    fun `image facts are explicitly binding for the reply model`() {
        val facts = ImageUnderstandingPolicy.modelFacts(
            type = "image",
            description = "图中是一个小女孩，穿着黄色上衣"
        )

        assertTrue(facts.contains("小女孩"))
        assertTrue(facts.contains("客观识别事实"))
        assertTrue(facts.contains("必须以这条识别事实为准"))
        assertFalse(facts.contains("你对象"))
    }
}
