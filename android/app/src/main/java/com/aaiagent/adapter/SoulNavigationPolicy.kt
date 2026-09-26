package com.aaiagent.adapter

enum class SoulNavigationAction {
    NONE,
    TAP_MESSAGE_TAB,
    TAP_SPLASH_SKIP,
    BACK,
    WAIT
}

object SoulNavigationPolicy {
    fun decide(
        isInMessageList: Boolean,
        hasMessageTab: Boolean,
        hasSplashSkip: Boolean,
        isInChat: Boolean
    ): SoulNavigationAction = when {
        isInMessageList -> SoulNavigationAction.NONE
        hasSplashSkip -> SoulNavigationAction.TAP_SPLASH_SKIP
        hasMessageTab -> SoulNavigationAction.TAP_MESSAGE_TAB
        isInChat -> SoulNavigationAction.BACK
        else -> SoulNavigationAction.WAIT
    }
}

object SoulConversationScanPolicy {
    fun isMessageList(
        conversationListVisible: Boolean,
        searchVisible: Boolean,
        visibleConversationCount: Int,
        chatTabSelected: Boolean
    ): Boolean {
        if (!conversationListVisible) return false
        if (searchVisible) return true
        return visibleConversationCount > 0 && chatTabSelected
    }

    fun canUseUnreadBadge(
        badgeVisible: Boolean,
        itemVisible: Boolean,
        left: Int,
        top: Int,
        right: Int,
        bottom: Int,
        screenWidth: Int,
        screenHeight: Int
    ): Boolean {
        if (!badgeVisible || !itemVisible) return false
        if (right <= left || bottom <= top) return false
        return right > 0 && bottom > 0 && left < screenWidth && top < screenHeight
    }
}
