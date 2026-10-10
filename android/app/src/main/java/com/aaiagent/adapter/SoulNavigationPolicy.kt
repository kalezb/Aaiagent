package com.aaiagent.adapter

enum class SoulNavigationAction {
    NONE,
    TAP_TOP_CHAT_TAB,
    TAP_MESSAGE_TAB,
    TAP_SPLASH_SKIP,
    TAP_SECONDARY_BACK,
    BACK,
    WAIT
}

object SoulNavigationPolicy {
    /**
     * Soul needs several seconds (cold start, splash, feed) before its bottom
     * tab bar exists. Pressing Back after two short waits used to quit the app
     * and start an open/close loop, so the budget is much larger now.
     */
    const val MAX_UNKNOWN_PAGE_WAITS_BEFORE_BACK = 12

    fun decide(
        isInMessageList: Boolean,
        hasMessageTab: Boolean,
        hasSplashSkip: Boolean,
        isInChat: Boolean,
        hasTopChatTab: Boolean = false,
        topChatTabSelected: Boolean = true,
        hasSecondaryBack: Boolean = false,
        isPublishPage: Boolean = false,
        unknownPageWaitCount: Int = 0,
        maxUnknownPageWaitsBeforeBack: Int = MAX_UNKNOWN_PAGE_WAITS_BEFORE_BACK,
        isMainTabPage: Boolean = false,
    ): SoulNavigationAction = when {
        isInMessageList -> SoulNavigationAction.NONE
        hasSplashSkip -> SoulNavigationAction.TAP_SPLASH_SKIP
        isPublishPage -> SoulNavigationAction.BACK
        isInChat -> SoulNavigationAction.BACK
        hasSecondaryBack -> SoulNavigationAction.TAP_SECONDARY_BACK
        hasTopChatTab && !topChatTabSelected -> SoulNavigationAction.TAP_TOP_CHAT_TAB
        hasMessageTab -> SoulNavigationAction.TAP_MESSAGE_TAB
        // The bottom tab bar only exists inside Soul's main page. Back from
        // there leaves the app entirely, which is never a way to find the list.
        isMainTabPage -> SoulNavigationAction.WAIT
        unknownPageWaitCount >= maxUnknownPageWaitsBeforeBack -> SoulNavigationAction.BACK
        else -> SoulNavigationAction.WAIT
    }

    fun isCommercePage(visibleTexts: Iterable<String>): Boolean {
        return visibleTexts.any { raw ->
            val text = raw.trim()
            text.isNotEmpty() && COMMERCE_KEYWORDS.any(text::contains)
        }
    }

    private val COMMERCE_KEYWORDS = listOf(
        "开通会员",
        "会员中心",
        "立即支付",
        "收银台",
        "确认支付",
        "充值",
        "购买",
        "付款",
    )
}

object SoulConversationScanPolicy {
    fun isMessageList(
        conversationListVisible: Boolean,
        searchVisible: Boolean,
        visibleConversationCount: Int,
        chatTabSelected: Boolean,
        publishPageVisible: Boolean = false,
        squarePageVisible: Boolean = false,
        topChatTabVisible: Boolean = false,
        topChatTabSelected: Boolean = true,
        bottomTabSelfSelected: Boolean = chatTabSelected
    ): Boolean {
        if (publishPageVisible) return false
        if (squarePageVisible) return false
        if (topChatTabVisible && !topChatTabSelected) return false
        if (!conversationListVisible) return false
        if (searchVisible) return true
        // The selected flag on Soul's bottom tab is occasionally missing during
        // a redraw. Visible conversation rows are stronger evidence than that
        // transient flag, so do not force navigation in that case.
        return visibleConversationCount > 0 || bottomTabSelfSelected
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

    fun canReportConversationOpen(
        shouldClick: Boolean,
        tapSucceeded: Boolean
    ): Boolean {
        return !shouldClick || tapSucceeded
    }

    fun canOperateConversationRecycler(
        isMessageList: Boolean,
        hasConversationRecycler: Boolean
    ): Boolean {
        return isMessageList && hasConversationRecycler
    }

    fun shouldScheduleConversation(hasUnread: Boolean): Boolean {
        return hasUnread
    }

    fun canOpenConversation(hasUnread: Boolean, requireUnread: Boolean): Boolean {
        return !requireUnread || hasUnread
    }

    fun shouldSearchConversationList(userInteracting: Boolean): Boolean {
        return !userInteracting
    }

}
