package com.aaiagent

import com.aaiagent.adapter.SoulTapPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulTapPolicyTest {
    @Test
    fun `bottom navigation center is not moved into the content above it`() {
        val point = SoulTapPolicy.clampPoint(
            x = 756,
            y = 2244,
            screenWidth = 1080,
            screenHeight = 2252
        )

        assertEquals(756, point.x)
        assertEquals(2244, point.y)
    }

    @Test
    fun `point only moves when it is outside the physical screen`() {
        val belowScreen = SoulTapPolicy.clampPoint(
            x = 1200,
            y = 2500,
            screenWidth = 1080,
            screenHeight = 2252
        )
        val aboveScreen = SoulTapPolicy.clampPoint(
            x = -5,
            y = -10,
            screenWidth = 1080,
            screenHeight = 2252
        )

        assertEquals(1079, belowScreen.x)
        assertEquals(2251, belowScreen.y)
        assertEquals(0, aboveScreen.x)
        assertEquals(0, aboveScreen.y)
    }

    @Test
    fun `publish hotspot is never used as bottom navigation`() {
        assertFalse(
            SoulTapPolicy.isNavigationTapSafe(
                x = 534,
                y = 2251,
                screenWidth = 1080,
                screenHeight = 2252
            )
        )
    }

    @Test
    fun `bottom tab row is anchored to the physical screen`() {
        // The real device reports an app area of 2252px inside a 2400px screen.
        assertEquals(2310, SoulTapPolicy.bottomTabCenterY(realScreenHeight = 2400))
        assertEquals(
            2400 - SoulTapPolicy.BOTTOM_TAB_INSET_PX,
            SoulTapPolicy.bottomTabCenterY(realScreenHeight = 2400),
        )
        assertEquals(0, SoulTapPolicy.bottomTabCenterY(realScreenHeight = 0))
        // An oversized inset never pushes the tap above the middle of the screen.
        assertEquals(
            250,
            SoulTapPolicy.bottomTabCenterY(realScreenHeight = 500, insetPx = 400),
        )
        assertTrue(
            SoulTapPolicy.isNavigationTapSafe(
                x = 756,
                y = SoulTapPolicy.bottomTabCenterY(realScreenHeight = 2400),
                screenWidth = 1080,
                screenHeight = 2400,
            )
        )
    }

    @Test
    fun `chat bottom tab accepts the real Soul bounds`() {
        assertTrue(
            SoulTapPolicy.isBottomNavigationBounds(
                left = 648,
                top = 2237,
                right = 864,
                bottom = 2252,
                screenWidth = 1080,
                screenHeight = 2252
            )
        )
        assertTrue(
            SoulTapPolicy.isNavigationTapSafe(
                x = 756,
                y = 2244,
                screenWidth = 1080,
                screenHeight = 2252
            )
        )
    }

    @Test
    fun `a stale send node cannot be tapped after the page reuses it`() {
        assertFalse(
            SoulTapPolicy.matchesViewId(
                actualViewId = "cn.soulapp.android:id/main_tab_me",
                expectedViewId = "btn_send",
                prefix = "cn.soulapp.android:id/",
            )
        )
        assertTrue(
            SoulTapPolicy.matchesViewId(
                actualViewId = "cn.soulapp.android:id/btn_send",
                expectedViewId = "btn_send",
                prefix = "cn.soulapp.android:id/",
            )
        )
    }
}
