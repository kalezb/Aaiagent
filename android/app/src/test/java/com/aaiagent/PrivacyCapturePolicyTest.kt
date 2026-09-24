package com.aaiagent

import com.aaiagent.engine.PrivacyPhotoPolicy
import com.aaiagent.engine.ScreenCapturePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyCapturePolicyTest {
    @Test
    fun `all black screenshot is rejected`() {
        assertTrue(ScreenCapturePolicy.isMostlyBlack(IntArray(400)))
    }

    @Test
    fun `visible content is accepted`() {
        val samples = IntArray(400) { 180 }
        assertFalse(ScreenCapturePolicy.isMostlyBlack(samples))
    }

    @Test
    fun `tiny highlights do not make a secure black frame usable`() {
        val samples = IntArray(400)
        repeat(4) { samples[it] = 255 }
        assertTrue(ScreenCapturePolicy.isMostlyBlack(samples))
    }

    @Test
    fun `privacy capture failure uses model context instead of generic fallback`() {
        assertTrue(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = true,
                captureAvailable = false
            )
        )
        assertFalse(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = true,
                captureAvailable = true
            )
        )
        assertFalse(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = false,
                captureAvailable = false
            )
        )
    }
}
