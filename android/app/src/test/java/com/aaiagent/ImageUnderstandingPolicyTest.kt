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

    @Test
    fun `dynamic visual prompt asks for motion emotion and conversational meaning`() {
        val prompt = ImageUnderstandingPolicy.visionPrompt("dynamic_visual")

        assertTrue(prompt.contains("动作"))
        assertTrue(prompt.contains("情绪"))
        assertTrue(prompt.contains("聊天意思"))
        assertTrue(prompt.contains("打招呼"))
        assertTrue(prompt.contains("晚安"))
    }

    @Test
    fun `dynamic visual facts are labeled as a dynamic expression`() {
        val facts = ImageUnderstandingPolicy.modelFacts(
            type = "dynamic_visual",
            description = "黄色月亮闭着眼，旁边有星星，表达晚安和亲切问候"
        )

        assertTrue(facts.contains("动态表情"))
        assertTrue(facts.contains("月亮"))
        assertTrue(facts.contains("晚安"))
    }
}
