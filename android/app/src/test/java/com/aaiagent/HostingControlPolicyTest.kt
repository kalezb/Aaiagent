package com.aaiagent

import com.aaiagent.engine.HostingControlPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HostingControlPolicyTest {
    @Test
    fun `requires token before hosting starts`() {
        assertEquals(
            "请先验证设备钥匙",
            HostingControlPolicy.startFailure(hasToken = false, accessibilityReady = false)
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
