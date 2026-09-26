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
}
