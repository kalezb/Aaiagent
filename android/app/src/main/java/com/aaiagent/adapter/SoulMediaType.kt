package com.aaiagent.adapter

object SoulMediaType {
    const val VOICE = "voice"
    const val VOICE_EMOJI = "voice_emoji"

    fun resolve(
        hasVoiceEmoji: Boolean,
        hasVoice: Boolean,
        hasImage: Boolean,
        hasSnapPhoto: Boolean,
        hasText: Boolean,
        hasExchange: Boolean = false,
        hasMomentCard: Boolean = false
    ): String {
        return when {
            hasMomentCard -> SoulMomentCard.TYPE
            hasExchange -> "exchange"
            hasVoiceEmoji -> VOICE_EMOJI
            hasVoice -> VOICE
            hasImage || hasSnapPhoto -> "image"
            hasText -> "text"
            else -> "unknown"
        }
    }
}

object SoulVoiceContent {
    fun resolve(transcription: String, regularText: String): String {
        val spoken = transcription.trim()
        val caption = regularText.trim()
        return when {
            spoken.isNotEmpty() && caption.isNotEmpty() -> "对方语音转文字：$spoken $caption"
            spoken.isNotEmpty() -> "对方语音转文字：$spoken"
            caption.isNotEmpty() -> caption
            else -> "[语音]"
        }
    }
}
