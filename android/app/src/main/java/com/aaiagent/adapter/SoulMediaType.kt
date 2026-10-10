package com.aaiagent.adapter

object SoulMediaType {
    const val STICKER = "sticker"
    const val VOICE = "voice"
    const val VOICE_EMOJI = "voice_emoji"

    fun hasImageBubble(
        hasImageMarker: Boolean,
        hasIncomingSnapPhoto: Boolean,
        hasOutgoingSnapPhoto: Boolean
    ): Boolean = hasImageMarker || hasIncomingSnapPhoto || hasOutgoingSnapPhoto

    fun resolve(
        hasVoiceEmoji: Boolean,
        hasVoice: Boolean,
        hasImage: Boolean,
        hasSnapPhoto: Boolean,
        hasText: Boolean,
        hasExchange: Boolean = false,
        hasMomentCard: Boolean = false,
        hasSticker: Boolean = false
    ): String {
        return when {
            hasMomentCard -> SoulMomentCard.TYPE
            hasExchange -> "exchange"
            hasVoiceEmoji -> VOICE_EMOJI
            hasVoice -> VOICE
            hasSticker -> STICKER
            hasImage || hasSnapPhoto -> "image"
            hasText -> "text"
            else -> "unknown"
        }
    }
}

object SoulVoiceContent {
    /**
     * 什么内容都没有时的占位。
     *
     * 它同时是"自己发的语音"的**编号锚点**（见 SoulMessageIdentity），
     * 所以永远不能改成带文字的形式，否则同一条语音的编号会变、上下文里会重复出现。
     */
    const val PLACEHOLDER = "[语音]"

    /** 对方发来的语音：用 Soul 自带的转文字结果。行为与改动前完全一致。 */
    fun resolveIncoming(transcription: String, caption: String): String {
        val spoken = transcription.trim()
        val extra = caption.trim()
        return when {
            spoken.isNotEmpty() && extra.isNotEmpty() -> "对方语音转文字：$spoken $extra"
            spoken.isNotEmpty() -> "对方语音转文字：$spoken"
            extra.isNotEmpty() -> extra
            else -> PLACEHOLDER
        }
    }

    /**
     * 自己发出去的语音：用当时记下来的文字（见 SelfVoiceMemory）。
     *
     * 改动前这里也走"对方语音转文字"那条路 —— 等于把自己说的话标成对方说的；
     * 而我们自己的语音压根没有转文字结果，最后只剩一个 [语音]，
     * 大模型完全看不到自己说过什么，于是重复自己刚说的话、接不上对方的话。
     */
    fun resolveOutgoing(spokenText: String?, caption: String): String {
        val spoken = spokenText?.trim().orEmpty()
        val extra = caption.trim()
        return when {
            spoken.isNotEmpty() && extra.isNotEmpty() -> "$PLACEHOLDER $spoken $extra"
            spoken.isNotEmpty() -> "$PLACEHOLDER $spoken"
            extra.isNotEmpty() -> extra
            else -> PLACEHOLDER
        }
    }

    /** 兼容旧调用点：不指明方向时按"对方发的"处理（保持原行为）。 */
    fun resolve(transcription: String, regularText: String): String =
        resolveIncoming(transcription, regularText)

    /**
     * 算编号时该用哪段文字：**不论方向，语音一律用固定的 [语音]**。
     *
     * 为什么不能让转写内容进编号（2026-10-06 真机事故）：
     * 编号是 `soul␟来源␟类型␟时间锚点␟内容`，**内容也在里面**。
     * 对方语音的内容一开始是 `[语音]`，点了"转文字"之后变成 `对方语音转文字：xxx`
     * —— 同一条语音的编号就变了，在系统眼里成了**另一条新消息**。
     * 后果：去重、批次挑选、以及"这条到底是谁说的"全部错乱。
     * 真机症状：转写成功后重读聊天页拿回来的是**空内容**，
     * 大模型以为对方什么都没说，回了句"再说一遍呀，想听你说"。
     *
     * 所以定死一条规矩：**内容该带文字就带文字（大模型要看得见），编号必须稳。**
     */
    fun identityAnchor(isVoice: Boolean, content: String): String =
        if (isVoice) PLACEHOLDER else content
}
