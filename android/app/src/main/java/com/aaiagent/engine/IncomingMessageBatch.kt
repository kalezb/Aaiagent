package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

object IncomingMessageBatch {
    fun fingerprint(selection: Selection): String {
        return IncomingConversationTracker.fingerprint(
            selection.incoming.map(::stableToken)
        )
    }

    fun visibleFingerprint(messages: List<ChatMessage>): String {
        return IncomingConversationTracker.fingerprint(
            messages.map { "${it.sender}:${stableToken(it)}" }
        )
    }

    fun incomingHistoryFingerprint(messages: List<ChatMessage>): String {
        return IncomingConversationTracker.fingerprint(
            messages.filter { it.sender != "self" }
                .map(::stableToken)
        )
    }

    fun stableToken(message: ChatMessage): String {
        if (message.identityKey.isNotBlank()) {
            return "id:${IncomingMessageTracker.fingerprint(message.identityKey)}"
        }
        return "${message.type}:${IncomingMessageTracker.fingerprint(message.content)}"
    }

    fun select(messages: List<ChatMessage>): Selection? {
        val lastSelfIndex = messages.indexOfLast { it.sender == "self" }
        val incoming = messages
            .drop(lastSelfIndex + 1)
            .filter { it.sender != "self" }
        if (incoming.isEmpty()) return null

        var mediaTarget: ChatMessage? = null
        var bestPriority = 0
        for (message in incoming) {
            val priority = MEDIA_PRIORITY[message.type] ?: 0
            if (priority > 0 && priority >= bestPriority) {
                mediaTarget = message
                bestPriority = priority
            }
        }

        return Selection(
            incoming = incoming,
            latestIncoming = incoming.last(),
            mediaTarget = mediaTarget
        )
    }

    data class Selection(
        val incoming: List<ChatMessage>,
        val latestIncoming: ChatMessage,
        val mediaTarget: ChatMessage?
    )

    private val MEDIA_PRIORITY = mapOf(
        "voice_emoji" to 6,
        "exchange" to 5,
        "image" to 4,
        "voice" to 3,
        "sticker" to 2,
        "interaction" to 1
    )
}
