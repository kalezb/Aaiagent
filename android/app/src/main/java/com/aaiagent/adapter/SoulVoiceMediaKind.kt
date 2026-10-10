package com.aaiagent.adapter

object SoulVoiceMediaKind {
    fun isVoiceEmoji(
        hasEmojiIcon: Boolean,
        hasVoicePlay: Boolean,
        hasPlayStart: Boolean,
        hasNormalVoiceBubble: Boolean
    ): Boolean {
        return hasEmojiIcon && hasVoicePlay && hasPlayStart && !hasNormalVoiceBubble
    }
}
