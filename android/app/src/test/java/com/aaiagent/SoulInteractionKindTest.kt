package com.aaiagent

import com.aaiagent.adapter.SoulInteractionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulInteractionKindTest {
    @Test
    fun `expression image wins even when a generic image marker exists`() {
        assertEquals(
            SoulInteractionKind.EXPRESSION,
            SoulInteractionKind.resolve(
                hasLightInteraction = false,
                hasBareStaticSticker = false,
                hasExpressionImage = true
            )
        )
    }

    @Test
    fun `light and static structures keep their own paths`() {
        assertEquals(
            SoulInteractionKind.LIGHT,
            SoulInteractionKind.resolve(true, false, false)
        )
        assertEquals(
            SoulInteractionKind.STATIC,
            SoulInteractionKind.resolve(false, true, false)
        )
    }

    @Test
    fun `ordinary content is not classified as an interaction`() {
        assertNull(SoulInteractionKind.resolve(false, false, false))
    }
}
