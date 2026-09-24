package com.aaiagent

import com.aaiagent.adapter.SoulMediaType
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMediaTypeTest {
    @Test
    fun `voice has priority over other media markers`() {
        assertEquals("voice", resolve(hasVoice = true, hasImage = true, hasText = true))
    }

    @Test
    fun `sticker is recognized from the emoji marker`() {
        assertEquals("sticker", resolve(hasSticker = true))
    }

    @Test
    fun `interaction is recognized from poke markers`() {
        assertEquals("interaction", resolve(hasInteraction = true))
    }

    @Test
    fun `snap photo is treated as image instead of being skipped`() {
        assertEquals("image", resolve(hasSnapPhoto = true))
    }

    @Test
    fun `text is used when no media marker exists`() {
        assertEquals("text", resolve(hasText = true))
    }

    @Test
    fun `empty message item is unknown`() {
        assertEquals("unknown", resolve())
    }

    private fun resolve(
        hasVoice: Boolean = false,
        hasImage: Boolean = false,
        hasSticker: Boolean = false,
        hasInteraction: Boolean = false,
        hasSnapPhoto: Boolean = false,
        hasText: Boolean = false
    ): String {
        return SoulMediaType.resolve(
            hasVoice = hasVoice,
            hasImage = hasImage,
            hasSticker = hasSticker,
            hasInteraction = hasInteraction,
            hasSnapPhoto = hasSnapPhoto,
            hasText = hasText
        )
    }
}
