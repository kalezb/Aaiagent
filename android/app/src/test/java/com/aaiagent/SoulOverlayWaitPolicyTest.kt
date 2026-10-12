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

    @Test
    fun `blocking overlay like svga or gift animation must wait even if chat input is readable`() {
        // 全屏动效、SVGA、礼物播放时属于真正遮挡，即使输入框在树中也必须等待
        assertTrue(
            SoulOverlayWaitPolicy.shouldWaitForClear(
                chatUsable = true,
                overlayVisible = true,
                isBlockingOverlay = true
            )
        )
    }
}
