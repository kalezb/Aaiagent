package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * A voice can be replied to before Soul's transcript appears. Once the
 * transcript is visible later, that is new usable content for the same voice
 * item, so the agent should answer the transcript once.
 */
object TranscriptFollowUpPolicy {
    fun find(
        messages: List<ChatMessage>,
        isAlreadyReplied: (ChatMessage) -> Boolean,
    ): ChatMessage? {
        return messages
            .asReversed()
            .firstOrNull { message ->
                message.sender != "self" &&
                    message.type == "voice" &&
                    hasTranscript(message) &&
                    !isAlreadyReplied(message)
            }
    }

    private fun hasTranscript(message: ChatMessage): Boolean {
        return message.transcript.isNotBlank() ||
            message.content.contains("语音转文字")
    }
}
