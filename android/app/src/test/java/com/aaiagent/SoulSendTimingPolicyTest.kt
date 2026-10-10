package com.aaiagent

import com.aaiagent.adapter.SoulSendTimingPolicy
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulSendTimingPolicyTest {
    @Test
    fun `send confirmation retries stay bounded for interactive replies`() {
        assertTrue(SoulSendTimingPolicy.POST_FILL_SETTLE_MS in 150L..400L)
        assertTrue(SoulSendTimingPolicy.FIRST_VERIFY_DELAY_MS in 250L..600L)
        assertTrue(SoulSendTimingPolicy.RETRY_VERIFY_DELAY_MS in 300L..800L)
        assertTrue(SoulSendTimingPolicy.SEND_BUTTON_RETRY_DELAY_MS in 300L..800L)
    }
}
