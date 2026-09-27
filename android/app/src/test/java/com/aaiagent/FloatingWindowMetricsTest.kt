package com.aaiagent

import com.aaiagent.ui.components.FloatingWindowMetrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FloatingWindowMetricsTest {
    @Test
    fun `floating control uses compact half-area dimensions`() {
        val previousWidth = 174
        val previousHeight = 58
        val previousArea = previousWidth * previousHeight
        val currentArea = FloatingWindowMetrics.WIDTH_DP * FloatingWindowMetrics.HEIGHT_DP

        assertEquals(126, FloatingWindowMetrics.WIDTH_DP)
        assertEquals(42, FloatingWindowMetrics.HEIGHT_DP)
        assertEquals(FloatingWindowMetrics.HEIGHT_DP / 2, FloatingWindowMetrics.CORNER_RADIUS_DP)
        assertTrue(currentArea * 2 <= previousArea * 1.1)
    }
}
