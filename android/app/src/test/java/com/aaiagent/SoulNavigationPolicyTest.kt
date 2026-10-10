package com.aaiagent

import com.aaiagent.adapter.SoulNavigationAction
import com.aaiagent.adapter.SoulNavigationPolicy
import com.aaiagent.adapter.SoulConversationScanPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulNavigationPolicyTest {
    @Test
    fun `message list is a terminal navigation state`() {
        assertEquals(
            SoulNavigationAction.NONE,
            SoulNavigationPolicy.decide(
                isInMessageList = true,
                hasMessageTab = true,
                hasSplashSkip = true,
                isInChat = false
            )
        )
    }

    @Test
    fun `hidden message list leftovers are not a message list`() {
        assertFalse(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = false,
                searchVisible = false,
                visibleConversationCount = 10,
                chatTabSelected = false
            )
        )
    }

    @Test
    fun `visible search confirms the message list`() {
        assertTrue(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = true,
                visibleConversationCount = 0,
                chatTabSelected = false
            )
        )
    }

    @Test
    fun `selected chat tab confirms the message list with visible rows`() {
        assertTrue(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = false,
                visibleConversationCount = 1,
                chatTabSelected = true
            )
        )
    }

    @Test
    fun `visible conversation rows survive a missing selected flag`() {
        assertTrue(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = false,
                visibleConversationCount = 5,
                chatTabSelected = false,
                bottomTabSelfSelected = false,
            )
        )
    }

    @Test
    fun `contact subpage is not treated as the message list`() {
        assertFalse(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = true,
                visibleConversationCount = 0,
                chatTabSelected = true,
                topChatTabVisible = true,
                topChatTabSelected = false
            )
        )
    }

    @Test
    fun `visible square page wins over stale selected chat nodes`() {
        assertFalse(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = true,
                visibleConversationCount = 4,
                chatTabSelected = true,
                squarePageVisible = true,
                bottomTabSelfSelected = true
            )
        )
    }

    @Test
    fun `publish page wins over stale message list nodes`() {
        assertFalse(
            SoulConversationScanPolicy.isMessageList(
                conversationListVisible = true,
                searchVisible = true,
                visibleConversationCount = 4,
                chatTabSelected = true,
                publishPageVisible = true,
                bottomTabSelfSelected = true
            )
        )
    }

    @Test
    fun `invisible or offscreen unread badge cannot be clicked`() {
        assertFalse(
            SoulConversationScanPolicy.canUseUnreadBadge(
                badgeVisible = false,
                itemVisible = true,
                left = 900,
                top = 500,
                right = 950,
                bottom = 550,
                screenWidth = 1080,
                screenHeight = 2400
            )
        )
        assertFalse(
            SoulConversationScanPolicy.canUseUnreadBadge(
                badgeVisible = true,
                itemVisible = true,
                left = 1080,
                top = 500,
                right = 1130,
                bottom = 550,
                screenWidth = 1080,
                screenHeight = 2400
            )
        )
        assertTrue(
            SoulConversationScanPolicy.canUseUnreadBadge(
                badgeVisible = true,
                itemVisible = true,
                left = 984,
                top = 494,
                right = 1035,
                bottom = 545,
                screenWidth = 1080,
                screenHeight = 2400
            )
        )
    }

    @Test
    fun `conversation is not reported open when a requested tap fails`() {
        assertTrue(
            SoulConversationScanPolicy.canReportConversationOpen(
                shouldClick = false,
                tapSucceeded = false
            )
        )
        assertTrue(
            SoulConversationScanPolicy.canReportConversationOpen(
                shouldClick = true,
                tapSucceeded = true
            )
        )
        assertFalse(
            SoulConversationScanPolicy.canReportConversationOpen(
                shouldClick = true,
                tapSucceeded = false
            )
        )
    }

    @Test
    fun `conversation list never scrolls when the page or recycler is not confirmed`() {
        assertFalse(
            SoulConversationScanPolicy.canOperateConversationRecycler(
                isMessageList = false,
                hasConversationRecycler = true
            )
        )
        assertFalse(
            SoulConversationScanPolicy.canOperateConversationRecycler(
                isMessageList = true,
                hasConversationRecycler = false
            )
        )
        assertTrue(
            SoulConversationScanPolicy.canOperateConversationRecycler(
                isMessageList = true,
                hasConversationRecycler = true
            )
        )
    }

    @Test
    fun `only unread conversations are scheduled`() {
        assertTrue(SoulConversationScanPolicy.shouldScheduleConversation(hasUnread = true))
        assertFalse(SoulConversationScanPolicy.shouldScheduleConversation(hasUnread = false))
    }

    @Test
    fun `scheduled click rechecks the unread badge before opening`() {
        assertTrue(
            SoulConversationScanPolicy.canOpenConversation(
                hasUnread = true,
                requireUnread = true,
            )
        )
        assertFalse(
            SoulConversationScanPolicy.canOpenConversation(
                hasUnread = false,
                requireUnread = true,
            )
        )
        assertTrue(
            SoulConversationScanPolicy.canOpenConversation(
                hasUnread = false,
                requireUnread = false,
            )
        )
    }

    @Test
    fun `user browsing never starts an off-screen name lookup`() {
        assertFalse(SoulConversationScanPolicy.shouldSearchConversationList(userInteracting = true))
        assertTrue(SoulConversationScanPolicy.shouldSearchConversationList(userInteracting = false))
    }

    @Test
    fun `skip wins while an advertisement is visible`() {
        assertEquals(
            SoulNavigationAction.TAP_SPLASH_SKIP,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = true,
                isInChat = false
            )
        )
    }

    @Test
    fun `selected bottom chat tab still taps an unselected top chat tab`() {
        assertEquals(
            SoulNavigationAction.TAP_TOP_CHAT_TAB,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = false,
                isInChat = false,
                hasTopChatTab = true,
                topChatTabSelected = false
            )
        )
    }

    @Test
    fun `square page taps the message tab and never presses back`() {
        assertEquals(
            SoulNavigationAction.TAP_MESSAGE_TAB,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = false,
                isInChat = false
            )
        )
    }

    @Test
    fun `chat page backs out before retrying the message tab`() {
        assertEquals(
            SoulNavigationAction.BACK,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = true
            )
        )
    }

    @Test
    fun `chat page backs out even when a message tab is present`() {
        assertEquals(
            SoulNavigationAction.BACK,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = false,
                isInChat = true
            )
        )
    }

    @Test
    fun `secondary page uses its back control before tabs`() {
        assertEquals(
            SoulNavigationAction.TAP_SECONDARY_BACK,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = false,
                isInChat = false,
                hasSecondaryBack = true
            )
        )
    }

    @Test
    fun `publish page backs out immediately`() {
        assertEquals(
            SoulNavigationAction.BACK,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = false,
                isPublishPage = true
            )
        )
    }

    @Test
    fun `loading page waits instead of sending random navigation actions`() {
        assertEquals(
            SoulNavigationAction.WAIT,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = false
            )
        )
    }

    @Test
    fun `unknown page backs out only after a long bounded wait`() {
        val budget = SoulNavigationPolicy.MAX_UNKNOWN_PAGE_WAITS_BEFORE_BACK
        assertTrue(budget >= 10)
        assertEquals(
            SoulNavigationAction.WAIT,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = false,
                unknownPageWaitCount = budget - 1
            )
        )
        assertEquals(
            SoulNavigationAction.BACK,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = false,
                unknownPageWaitCount = budget
            )
        )
    }

    @Test
    fun `main tab page never backs out of the app`() {
        // Regression: Back on the square page quit Soul, so the engine looped
        // between launching and closing the app instead of opening the list.
        val budget = SoulNavigationPolicy.MAX_UNKNOWN_PAGE_WAITS_BEFORE_BACK
        assertEquals(
            SoulNavigationAction.WAIT,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = false,
                hasSplashSkip = false,
                isInChat = false,
                unknownPageWaitCount = budget * 3,
                isMainTabPage = true,
            )
        )
    }

    @Test
    fun `main tab page still prefers the message tab over waiting`() {
        assertEquals(
            SoulNavigationAction.TAP_MESSAGE_TAB,
            SoulNavigationPolicy.decide(
                isInMessageList = false,
                hasMessageTab = true,
                hasSplashSkip = false,
                isInChat = false,
                unknownPageWaitCount = 5,
                isMainTabPage = true,
            )
        )
    }

    @Test
    fun `commerce page is detected before any navigation tap`() {
        assertTrue(
            SoulNavigationPolicy.isCommercePage(
                listOf("开通会员", "立即支付")
            )
        )
        assertFalse(
            SoulNavigationPolicy.isCommercePage(
                listOf("你好", "在干嘛")
            )
        )
    }
}
