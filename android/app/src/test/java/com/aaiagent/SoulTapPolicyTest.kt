package com.aaiagent

import com.aaiagent.adapter.SoulTapPolicy
import org.junit.Assert.assertEquals
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
}
