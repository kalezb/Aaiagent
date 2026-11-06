package com.aaiagent

import com.aaiagent.service.AccessibilityEventThrottlePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityEventThrottlePolicyTest {
    @Test
    fun `burst content changes are merged`() {
        val first = AccessibilityEventThrottlePolicy.shouldHandleContentChange(
            nowMs = 10_000L,
            lastHandledAtMs = 9_800L,
        )
        val later = AccessibilityEventThrottlePolicy.shouldHandleContentChange(
            nowMs = 10_401L,
            lastHandledAtMs = 10_000L,
        )

        assertFalse(first)
        assertTrue(later)
    }

    @Test
    fun `full page inspection is limited while passive events continue`() {
        assertFalse(
            AccessibilityEventThrottlePolicy.shouldInspectTree(
                nowMs = 10_000L,
                lastInspectedAtMs = 9_000L,
            )
        )
        assertTrue(
            AccessibilityEventThrottlePolicy.shouldInspectTree(
                nowMs = 10_500L,
                lastInspectedAtMs = 9_000L,
            )
        )
    }
}
