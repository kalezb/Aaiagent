package com.aaiagent

import com.aaiagent.adapter.SoulMediaType
import com.aaiagent.adapter.SoulVoiceContent
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMediaTypeTest {
    @Test
    fun `voice has priority over other media markers`() {
        assertEquals("voice", resolve(hasVoice = true, hasImage = true, hasText = true))
    }

    @Test
    fun `voice emoji has priority over ordinary voice markers`() {
        assertEquals(
            "voice_emoji",
            resolve(hasVoiceEmoji = true, hasVoice = true, hasText = true)
        )
    }

    @Test
    fun `snap photo is treated as image instead of being skipped`() {
        assertEquals("image", resolve(hasSnapPhoto = true, hasText = true))
    }

    @Test
    fun `exchange card has priority over its image markers`() {
        assertEquals(
            "exchange",
            resolve(hasImage = true, hasSnapPhoto = true, hasText = true, hasExchange = true)
        )
    }

    @Test
    fun `forwarded moment card is not mistaken for a sticker or image`() {
        assertEquals(
            "moment_card",
            resolve(hasImage = true, hasMomentCard = true)
        )
    }
    @Test
    fun `text is used when no media marker exists`() {
        assertEquals("text", resolve(hasText = true))
    }

    @Test
    fun `empty message item is unknown`() {
        assertEquals("unknown", resolve())
    }

    @Test
    fun `voice transcript keeps its own text instead of becoming a plain text message`() {
        assertEquals(
            "对方语音转文字：今天天气特别冷",
            SoulVoiceContent.resolve("今天天气特别冷", "")
        )
        assertEquals(
            "对方语音转文字：今天天气特别冷 你那边呢",
            SoulVoiceContent.resolve("今天天气特别冷", "你那边呢")
        )
        assertEquals("[语音]", SoulVoiceContent.resolve("", ""))
    }

    private fun resolve(
        hasVoiceEmoji: Boolean = false,
        hasVoice: Boolean = false,
        hasImage: Boolean = false,
        hasSnapPhoto: Boolean = false,
        hasText: Boolean = false,
        hasExchange: Boolean = false,
        hasMomentCard: Boolean = false
    ): String {
        return SoulMediaType.resolve(
            hasVoiceEmoji = hasVoiceEmoji,
            hasVoice = hasVoice,
            hasImage = hasImage,
            hasSnapPhoto = hasSnapPhoto,
            hasText = hasText,
            hasExchange = hasExchange,
            hasMomentCard = hasMomentCard
        )
    }
}
