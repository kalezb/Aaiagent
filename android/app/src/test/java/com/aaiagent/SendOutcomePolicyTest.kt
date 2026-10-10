package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.SendOutcomePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SendOutcomePolicyTest {
    @Test
    fun `not verified but visible in chat counts as sent`() {
        // 2026-10-07 真机（豆包）：聊天里已出现这句话，却因 NOT_VERIFIED 没确认上传，云端永久缺这条。
        assertTrue(SendOutcomePolicy.treatedAsSent(PlatformAdapter.SendResult.NOT_VERIFIED, true))
    }

    @Test
    fun `not verified and not visible is still a failure`() {
        assertFalse(SendOutcomePolicy.treatedAsSent(PlatformAdapter.SendResult.NOT_VERIFIED, false))
    }

    @Test
    fun `success stays success and other failures stay failures`() {
        assertTrue(SendOutcomePolicy.treatedAsSent(PlatformAdapter.SendResult.SUCCESS, false))
        assertFalse(SendOutcomePolicy.treatedAsSent(PlatformAdapter.SendResult.STOPPED, true))
        assertFalse(SendOutcomePolicy.treatedAsSent(PlatformAdapter.SendResult.BANNED, true))
    }
}
