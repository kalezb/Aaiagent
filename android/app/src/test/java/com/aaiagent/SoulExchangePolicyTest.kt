package com.aaiagent

import com.aaiagent.adapter.SoulExchangePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulExchangePolicyTest {
    @Test
    fun `privacy must be enabled before exchange can be submitted`() {
        assertFalse(
            SoulExchangePolicy.isPrivacyEnabled(
                SoulExchangePolicy.PRIVACY_DISABLED_LABEL,
                checked = false
            )
        )
        assertFalse(
            SoulExchangePolicy.isPrivacyEnabled(
                SoulExchangePolicy.PRIVACY_ENABLED_LABEL,
                checked = false
            )
        )
        assertTrue(
            SoulExchangePolicy.isPrivacyEnabled(
                SoulExchangePolicy.PRIVACY_ENABLED_LABEL,
                checked = true
            )
        )
    }

    @Test
    fun `sent exchange message must carry the no download and no screenshot tag`() {
        assertTrue(
            SoulExchangePolicy.isProtectedMessage(
                status = "隐私保护",
                tag = "对方无法下载/截屏"
            )
        )
        assertFalse(
            SoulExchangePolicy.isProtectedMessage(
                status = "隐私保护",
                tag = null
            )
        )
    }

    @Test
    fun `exchange label tolerates whitespace from accessibility text`() {
        assertTrue(SoulExchangePolicy.isExchangeLabel(" 以 图 换 图 "))
        assertFalse(SoulExchangePolicy.isExchangeLabel("交换图片"))
    }

    @Test
    fun `device fallback point stays on the exchange submit control`() {
        val point = SoulExchangePolicy.fallbackSubmitPoint(
            screenWidth = 1080,
            screenHeight = 2400
        )
        assertEquals(922, point.x)
        assertEquals(2296, point.y)
    }
}
