package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.SoulMomentCard

object IncomingMessageBatch {
    enum class ChangeKind {
        SAME,
        PEER_APPENDED,
        SELF_APPENDED,
        AMBIGUOUS
    }

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
            val transcriptAnchor = when {
                message.type != "voice" -> ""
                message.transcript.isNotBlank() ->
                    ":transcript:${IncomingMessageTracker.fingerprint(message.transcript)}"
                message.content.contains("语音转文字") ->
                    ":transcript-content:${IncomingMessageTracker.fingerprint(message.content)}"
                else -> ""
            }
            return "id:${IncomingMessageTracker.fingerprint(message.identityKey)}$transcriptAnchor"
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
        // 转发动态卡片是"文字 + 配图"的混合消息：正文要读、配图也要看，
        // 所以它不受"有独立文字就跳过媒体"这条省成本规则约束，否则整条卡片会被丢掉。
        val mediaTarget = if (latestMedia?.type == SoulMomentCard.TYPE) {
            latestMedia
        } else {
            latestMedia.takeUnless { preferTextOnly }
        }

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

    fun requestMessages(messages: List<ChatMessage>): List<ChatMessage> {
        return select(messages)?.let(::replyMessages) ?: messages
    }

    fun transcriptFollowUp(message: ChatMessage): Selection {
        return Selection(
            incoming = listOf(message),
            latestIncoming = message,
            mediaTarget = message,
            textTarget = null,
            preferTextOnly = false,
        )
    }

    /**
     * Classifies the visible transcript change without treating a re-read of the
     * same accessibility tree as a new incoming turn.
     */
    fun classifyChange(
        previous: List<ChatMessage>,
        current: List<ChatMessage>,
    ): ChangeKind {
        if (current.isEmpty()) return ChangeKind.SAME
        if (sameSequence(previous, current) || isSuffix(previous, current) || isSuffix(current, previous)) {
            return ChangeKind.SAME
        }

        val appendedStart = appendStart(previous, current)
        if (appendedStart != null) {
            val appended = current.drop(appendedStart)
            if (appended.isEmpty()) return ChangeKind.SAME
            val hasPeer = appended.any { it.sender != "self" }
            val hasSelf = appended.any { it.sender == "self" }
            return when {
                hasPeer && !hasSelf -> ChangeKind.PEER_APPENDED
                hasSelf && !hasPeer -> ChangeKind.SELF_APPENDED
                else -> ChangeKind.AMBIGUOUS
            }
        }

        return ChangeKind.AMBIGUOUS
    }

    data class Selection(
        val incoming: List<ChatMessage>,
        val latestIncoming: ChatMessage,
        val mediaTarget: ChatMessage?,
        val textTarget: ChatMessage? = null,
        val preferTextOnly: Boolean = false
    )

    private fun isTextualReplyMessage(message: ChatMessage): Boolean {
        // 转发动态卡片自带可读的正文，算"有文字"，不能当成纯图片丢掉。
        if (message.type != "text" && message.type != SoulMomentCard.TYPE) return false
        return message.content.trim().isNotEmpty()
    }

    private fun requiresMediaContext(text: String): Boolean {
        val compact = text.trim().replace(Regex("\\s+"), "")
        return compact.length <= 32 && MEDIA_REFERENCE.containsMatchIn(compact)
    }

    private fun sameSequence(
        left: List<ChatMessage>,
        right: List<ChatMessage>,
    ): Boolean {
        return left.size == right.size && left.indices.all { sameMessage(left[it], right[it]) }
    }

    private fun isSuffix(
        candidate: List<ChatMessage>,
        full: List<ChatMessage>,
    ): Boolean {
        if (candidate.size > full.size) return false
        val start = full.size - candidate.size
        return candidate.indices.all { sameMessage(candidate[it], full[start + it]) }
    }

    private fun appendStart(
        previous: List<ChatMessage>,
        current: List<ChatMessage>,
    ): Int? {
        if (previous.isEmpty()) return 0
        if (current.size <= previous.size) return null
        for (start in 0..(current.size - previous.size)) {
            val matches = previous.indices.all { index ->
                sameMessage(previous[index], current[start + index])
            }
            if (matches) return start + previous.size
        }
        return null
    }

    private fun sameMessage(left: ChatMessage, right: ChatMessage): Boolean {
        return left.sender == right.sender && stableToken(left) == stableToken(right)
    }

    private val MEDIA_TYPES = setOf(
        "voice_emoji",
        "exchange",
        "image",
        "voice",
        "sticker",
        "interaction",
        SoulMomentCard.TYPE
    )

    private val MEDIA_REFERENCE = Regex(
        "(?:看看|看一下|看下|这张|那张|这个图|那个图|照片|图片|截图|听一下|听下|这条语音|这个语音|视频)"
    )
}
