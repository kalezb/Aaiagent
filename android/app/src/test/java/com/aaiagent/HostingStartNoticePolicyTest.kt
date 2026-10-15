package com.aaiagent

import com.aaiagent.engine.HostingStartNoticePolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class HostingStartNoticePolicyTest {
    @Test
    fun `warns when whitelist limits hosting`() {
        assertEquals(
            "提醒：当前有白名单2位，AI托管只会回复白名单联系人",
            HostingStartNoticePolicy.notice(
                whitelist = listOf("梦想", "小北"),
                blacklist = emptyList(),
            ),
        )
    }

    @Test
    fun `warns about blacklist when there is no whitelist`() {
        assertEquals(
            "提醒：当前有黑名单1位，这些联系人会被跳过",
            HostingStartNoticePolicy.notice(
                whitelist = emptyList(),
                blacklist = listOf("雾锁星河岸"),
            ),
        )
    }

    @Test
    fun `stays silent when both filters are empty`() {
        assertEquals(
            "",
            HostingStartNoticePolicy.notice(
                whitelist = emptyList(),
                blacklist = emptyList(),
            ),
        )
    }
}
