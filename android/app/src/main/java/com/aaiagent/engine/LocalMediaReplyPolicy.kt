package com.aaiagent.engine

import com.aaiagent.adapter.SoulMediaType

object LocalMediaReplyPolicy {
    const val VOICE_REPLY = "以后别发语音，我很反感，谢谢"
    const val VOICE_EMOJI_REPLY = "以后别发语音表情，我很反感，谢谢"

    fun replyFor(batch: IncomingMessageBatch.Selection): String? {
        if (batch.mediaTarget?.type == SoulMediaType.VOICE_EMOJI) {
            return VOICE_EMOJI_REPLY
        }
        if (batch.incoming.isNotEmpty() && batch.incoming.all { it.type == SoulMediaType.VOICE }) {
            return VOICE_REPLY
        }
        return null
    }
}
