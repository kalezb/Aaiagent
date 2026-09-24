package com.aaiagent.adapter

object SoulMediaType {
    fun resolve(
        hasVoice: Boolean,
        hasImage: Boolean,
        hasSticker: Boolean,
        hasInteraction: Boolean,
        hasSnapPhoto: Boolean,
        hasText: Boolean
    ): String {
        return when {
            hasVoice -> "voice"
            hasSticker -> "sticker"
            hasInteraction -> "interaction"
            hasImage || hasSnapPhoto -> "image"
            hasText -> "text"
            else -> "unknown"
        }
    }
}
