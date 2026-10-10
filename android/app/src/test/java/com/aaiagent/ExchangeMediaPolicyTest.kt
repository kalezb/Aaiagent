package com.aaiagent

import com.aaiagent.engine.ExchangeMediaPolicy
import com.aaiagent.engine.HostingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExchangeMediaPolicyTest {
    @Test
    fun usesStableRequestIdForSameExchangeMessage() {
        val first = ExchangeMediaPolicy.requestId("contact-1", "exchange-1", "[以图换图]")
        val second = ExchangeMediaPolicy.requestId("contact-1", "exchange-1", "[以图换图]")
        val otherContact = ExchangeMediaPolicy.requestId("contact-2", "exchange-1", "[以图换图]")

        assertEquals(first, second)
        assertFalse(first == otherContact)
        assertTrue(first.startsWith("exchange-"))
    }

    @Test
    fun stagesDailyOnlyInFullAutoMode() {
        assertTrue(ExchangeMediaPolicy.shouldStageDaily(HostingMode.FULL_AUTO))
        assertFalse(ExchangeMediaPolicy.shouldStageDaily(HostingMode.SEMI_AUTO))
        assertFalse(ExchangeMediaPolicy.shouldStageDaily(HostingMode.MONITOR_ONLY))
        assertEquals("daily", ExchangeMediaPolicy.DAILY_GROUP_ID)
    }

    /**
     * 后端回 `skip` 是**最终答复**，不是"还没准备好"。
     *
     * 真机事故（2026-10-06 19:01）：后端因为人设不在"日常照"开放范围内，
     * 对每一次以图换图都回 skip；代码却当成"媒体加载未完成"，
     * 于是每 6 秒重试一次、无限循环。
     */
    @Test
    fun aBackendSkipIsNeverRetried() {
        assertFalse(ExchangeMediaPolicy.shouldRetryAfterSelection("skip"))
        // 大小写和空格都别放过 —— 后端换个写法就又转起来了。
        assertFalse(ExchangeMediaPolicy.shouldRetryAfterSelection(" SKIP "))
        assertFalse(ExchangeMediaPolicy.shouldRetryAfterSelection("Skip"))
    }

    @Test
    fun otherAnswersStillRetry() {
        // "send_media" 走到这里说明媒体不完整，那是真的还没准备好，该重试。
        assertTrue(ExchangeMediaPolicy.shouldRetryAfterSelection("send_media"))
        assertTrue(ExchangeMediaPolicy.shouldRetryAfterSelection(""))
        assertTrue(ExchangeMediaPolicy.shouldRetryAfterSelection(null))
    }
}
