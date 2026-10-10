package com.aaiagent

import com.aaiagent.engine.HostingControlPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HostingControlPolicyTest {
    @Test
    fun `requires token before hosting starts`() {
        assertEquals(
            "请先验证设备密钥",
            HostingControlPolicy.startFailure(hasToken = false, accessibilityReady = false)
        )
    }

    @Test
    fun `requires backend verification before hosting starts`() {
        assertEquals(
            "设备密钥未通过后端验证",
            HostingControlPolicy.startFailure(
                hasToken = true,
                tokenVerified = false,
                accessibilityReady = true
            )
        )
    }

    @Test
    fun `requires accessibility service after token`() {
        assertEquals(
            "无障碍服务未启动",
            HostingControlPolicy.startFailure(hasToken = true, accessibilityReady = false)
        )
    }

    @Test
    fun `allows hosting when token and accessibility are ready`() {
        assertNull(HostingControlPolicy.startFailure(hasToken = true, accessibilityReady = true))
    }
}
