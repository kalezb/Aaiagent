package com.aaiagent

import com.aaiagent.engine.DynamicVisualCapturePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DynamicVisualCapturePolicyTest {
    @Test
    fun `only an unknown dynamic visual waits before capture`() {
        assertTrue(DynamicVisualCapturePolicy.shouldWaitBeforeCapture("dynamic_visual"))
        assertFalse(DynamicVisualCapturePolicy.shouldWaitBeforeCapture("image"))
        assertFalse(DynamicVisualCapturePolicy.shouldWaitBeforeCapture("sticker"))
        assertFalse(DynamicVisualCapturePolicy.shouldWaitBeforeCapture("text"))
    }

    @Test
    fun `dynamic visual waits several seconds without freezing the whole chat`() {
        assertTrue(DynamicVisualCapturePolicy.SETTLE_BEFORE_CAPTURE_MS >= 3_000L)
        assertTrue(DynamicVisualCapturePolicy.SETTLE_BEFORE_CAPTURE_MS <= 5_000L)
    }
}
