package com.aaiagent

import com.aaiagent.adapter.SoulOverlayWaitPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulOverlayWaitPolicyTest {
    @Test
    fun `usable chat page never waits for a decorative overlay`() {
        // Regression: Soul keeps pb_light_interaction visible forever, so the
        // old unconditional wait burned ~4.2s twice per conversation.
        assertFalse(SoulOverlayWaitPolicy.shouldWaitForClear(chatUsable = true, overlayVisible = true))
    }

    @Test
    fun `chat page without an input bar still waits for the overlay to clear`() {
        assertTrue(SoulOverlayWaitPolicy.shouldWaitForClear(chatUsable = false, overlayVisible = true))
    }

    @Test
    fun `no overlay means no wait`() {
        assertFalse(SoulOverlayWaitPolicy.shouldWaitForClear(chatUsable = true, overlayVisible = false))
        assertFalse(SoulOverlayWaitPolicy.shouldWaitForClear(chatUsable = false, overlayVisible = false))
    }
}
