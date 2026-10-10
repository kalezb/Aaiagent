package com.aaiagent.engine

enum class ChatVerificationAction {
    VERIFIED,
    RETRY,
    BACK_TO_LIST,
    ABORT
}

/**
 * Decides how chat verification may change the current page.
 *
 * The automation must never press Back merely because verification timed out.
 * If the target app is no longer foreground, Back can close the app and leave
 * the user on the launcher.
 */
object ChatVerificationPolicy {
    fun decide(
        targetPackageForeground: Boolean,
        inChat: Boolean,
        expectedContactName: String,
        actualTitle: String?,
        identityConfirmed: Boolean = false,
    ): ChatVerificationAction = when {
        !targetPackageForeground -> ChatVerificationAction.ABORT
        identityConfirmed -> ChatVerificationAction.VERIFIED
        !inChat -> ChatVerificationAction.RETRY
        ConversationIdentity.matches(expectedContactName, actualTitle) ->
            ChatVerificationAction.VERIFIED
        actualTitle.isNullOrBlank() || ChatTitlePolicy.isTransient(actualTitle) ->
            ChatVerificationAction.RETRY
        else -> ChatVerificationAction.BACK_TO_LIST
    }

    fun canPressBack(
        targetPackageForeground: Boolean,
        inChat: Boolean
    ): Boolean = targetPackageForeground && inChat
}
