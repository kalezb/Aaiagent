package com.aaiagent

import com.aaiagent.adapter.SoulDynamicVisualPolicy
import com.aaiagent.adapter.SoulMediaType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulDynamicVisualPolicyTest {
    @Test
    fun `empty clickable bubble is recognized as a dynamic visual message`() {
        assertTrue(
            SoulDynamicVisualPolicy.isBareDynamicVisual(
                hasClickableView = true,
                hasText = false,
                hasKnownMedia = false,
            )
        )
    }

    @Test
    fun `text voice image and known stickers keep their existing type`() {
        assertFalse(
            SoulDynamicVisualPolicy.isBareDynamicVisual(
                hasClickableView = true,
                hasText = true,
                hasKnownMedia = false,
            )
        )
        assertFalse(
            SoulDynamicVisualPolicy.isBareDynamicVisual(
                hasClickableView = true,
                hasText = false,
                hasKnownMedia = true,
            )
        )
    }

    @Test
    fun `specific list preview avoids an unnecessary vision call`() {
        val classification = SoulDynamicVisualPolicy.classify("[晚上好]")

        assertEquals("text", classification.type)
        assertTrue(classification.content.contains("晚上好"))
        assertFalse(classification.needsVision)
    }

    @Test
    fun `generic preview becomes a dynamic visual that needs vision`() {
        listOf("[图片]", "[表情]", "[动态表情]", "[动图]").forEach { preview ->
            val classification = SoulDynamicVisualPolicy.classify(preview)

            assertEquals(SoulMediaType.DYNAMIC_VISUAL, classification.type)
            assertEquals("[动态表情]", classification.content)
            assertTrue(classification.needsVision)
        }
    }
}
