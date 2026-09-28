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

        // Standalone text outranks media so older images or voice do not add model cost.
        val textTarget = incoming.lastOrNull(::isTextualReplyMessage)
        val preferTextOnly = textTarget != null &&
            !requiresMediaContext(textTarget.content)
        val latestMedia = incoming.lastOrNull { it.type in MEDIA_TYPES }
        val mediaTarget = latestMedia.takeUnless { preferTextOnly }

        return Selection(
            incoming = incoming,
            latestIncoming = incoming.last(),
            mediaTarget = mediaTarget,
            textTarget = textTarget,
            preferTextOnly = preferTextOnly
        )
    }

    fun replyMessages(selection: Selection): List<ChatMessage> {
        if (!selection.preferTextOnly) return selection.incoming
        return selection.incoming
            .filter(::isTextualReplyMessage)
            .ifEmpty { selection.incoming }
    }

    data class Selection(
        val incoming: List<ChatMessage>,
        val latestIncoming: ChatMessage,
        val mediaTarget: ChatMessage?,
        val textTarget: ChatMessage? = null,
        val preferTextOnly: Boolean = false
    )

    private fun isTextualReplyMessage(message: ChatMessage): Boolean {
        if (message.type != "text" && message.type != "moment_card") return false
        return message.content.trim().isNotEmpty()
    }

    private fun requiresMediaContext(text: String): Boolean {
        val compact = text.trim().replace(Regex("\\s+"), "")
        return compact.length <= 32 && MEDIA_REFERENCE.containsMatchIn(compact)
    }

    private val MEDIA_TYPES = setOf(
        "voice_emoji",
        "exchange",
        "image",
        "voice",
        "sticker",
        "interaction"
    )

    private val MEDIA_REFERENCE = Regex(
        "(?:看看|看一下|看下|这张|那张|这个图|那个图|照片|图片|截图|听一下|听下|这条语音|这个语音|视频)"
    )
}
