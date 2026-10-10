package com.aaiagent.engine

enum class ChatPageIdentityDecision {
    CONFIRMED,
    READ_ONLY,
    WAIT,
    NOT_CHAT,
}

/**
 * Remembers one exact contact name for the current chat window.
 *
 * A transient status such as "正在输入" is only trusted after the exact
 * contact name has already been seen in the same chat window.
 */
class ChatPageIdentityTracker {
    private var confirmedWindowId: Int? = null
    private var confirmedContactKey: String = ""

    fun reset() {
        confirmedWindowId = null
        confirmedContactKey = ""
    }

    fun rememberConfirmedTitle(
        windowId: Int,
        expectedContact: String,
        actualTitle: String?,
    ): Boolean {
        if (!ConversationIdentity.matches(expectedContact, actualTitle)) return false
        confirmedWindowId = windowId
        confirmedContactKey = ConversationIdentity.normalize(expectedContact)
        return true
    }

    fun observe(
        windowId: Int,
        inChat: Boolean,
        expectedContact: String,
        actualTitle: String?,
        previewMatches: Boolean,
    ): ChatPageIdentityDecision {
        if (!inChat) return ChatPageIdentityDecision.NOT_CHAT

        val expectedKey = ConversationIdentity.normalize(expectedContact)
        if (expectedKey.isBlank()) return ChatPageIdentityDecision.WAIT

        if (rememberConfirmedTitle(windowId, expectedContact, actualTitle)) {
            return ChatPageIdentityDecision.CONFIRMED
        }

        val cachedForThisWindow =
            confirmedWindowId == windowId && confirmedContactKey == expectedKey
        if (cachedForThisWindow && ChatTitlePolicy.isTransient(actualTitle)) {
            return ChatPageIdentityDecision.CONFIRMED
        }

        if (ChatTitlePolicy.isTransient(actualTitle) && previewMatches) {
            return ChatPageIdentityDecision.READ_ONLY
        }

        return ChatPageIdentityDecision.WAIT
    }
}
