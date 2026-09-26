package com.aaiagent

import com.aaiagent.adapter.SoulNavigationAction
import com.aaiagent.adapter.SoulNavigationPolicy
import org.junit.Assert.assertEquals
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
