package com.aaiagent.adapter

object SoulMediaType {
    fun resolve(
        hasVoice: Boolean,
        hasImage: Boolean,
        hasSticker: Boolean,
        hasInteraction: Boolean,
        hasSnapPhoto: Boolean,
        hasText: Boolean,
        hasExchange: Boolean = false
    ): String {
        return when {
            hasExchange -> "exchange"
            hasVoice -> "voice"
            hasSticker -> "sticker"
            hasInteraction -> "interaction"
            hasImage || hasSnapPhoto -> "image"
            hasText -> "text"
            else -> "unknown"
        }
    }
}
