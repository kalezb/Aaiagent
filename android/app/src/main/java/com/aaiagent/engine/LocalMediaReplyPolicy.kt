package com.aaiagent.engine

import com.aaiagent.adapter.SoulMediaType

object LocalMediaReplyPolicy {
    const val VOICE_REPLY = "以后别发语音，我很反感，谢谢"
    const val VOICE_EMOJI_REPLY = "以后别发语音表情，我很反感，谢谢"

    fun replyFor(batch: IncomingMessageBatch.Selection): String? {
        val latest = batch.latestIncoming
        if (latest.type == SoulMediaType.VOICE_EMOJI) {
            return VOICE_EMOJI_REPLY
        }
        if (latest.type == SoulMediaType.VOICE && batch.incoming.all { it.type == SoulMediaType.VOICE }) {
            return VOICE_REPLY
        }
        return null
    }
}
