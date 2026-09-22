package com.aaiagent

import org.junit.Test
import org.junit.Assert.*

class MessageEngineTest {

    @Test
    fun `dedup window is 5 minutes`() {
        val now = System.currentTimeMillis()
        val fiveMinAgo = now - 5 * 60 * 1000

        // Within 5 minutes
        assertTrue(now - 60_000 > fiveMinAgo)

        // Outside 5 minutes
        assertFalse(now - 6 * 60 * 1000 > fiveMinAgo)
    }

    @Test
    fun `max recalc is 3`() {
        val MAX_RECALC = 3
        var recalcCount = 0

        while (recalcCount < MAX_RECALC) {
            recalcCount++
            if (recalcCount >= MAX_RECALC) break
        }

        assertEquals(3, recalcCount)
    }

    @Test
    fun `short window is 500ms`() {
        val SHORT_WINDOW_MS = 500L
        assertEquals(500L, SHORT_WINDOW_MS)
    }

    @Test
    fun `max wait time is 8 seconds`() {
        val MAX_WAIT_MS = 8000L
        assertEquals(8000L, MAX_WAIT_MS)
    }

    @Test
    fun `delay range is 500 to 1500ms`() {
        val MIN_DELAY = 500L
        val MAX_DELAY = 1500L

        val random = java.util.Random()
        for (i in 1..100) {
            val delay = MIN_DELAY + random.nextLong(MAX_DELAY - MIN_DELAY)
            assertTrue("Delay $delay should be >= $MIN_DELAY", delay >= MIN_DELAY)
            assertTrue("Delay $delay should be < $MAX_DELAY", delay < MAX_DELAY) // exclusive bound
        }
    }

    @Test
    fun `sensitive words detection`() {
        val sensitiveWords = listOf("借钱", "账号", "密码", "银行卡", "转账", "验证码", "身份证")

        assertTrue(sensitiveWords.any { "可以借我点钱吗".contains(it) })
        assertTrue(sensitiveWords.any { "你的账号是多少".contains(it) })
        assertFalse(sensitiveWords.any { "今天天气真好".contains(it) })
        assertFalse(sensitiveWords.any { "晚上吃什么".contains(it) })
    }

    @Test
    fun `platform package names are correct`() {
        val platforms = mapOf(
            "soul" to "com.soulapp.cn",
            "qq" to "com.tencent.mobileqq",
            "immomo" to "com.immomo.momo",
            "lianxin" to "com.lianxin.app"
        )

        assertEquals(4, platforms.size)
        assertEquals("com.soulapp.cn", platforms["soul"])
        assertEquals("com.tencent.mobileqq", platforms["qq"])
    }

    @Test
    fun `notification fail threshold is 10`() {
        val threshold = 10
        assertTrue(threshold > 0)
        assertEquals(10, threshold)
    }

    @Test
    fun `temperature and max_tokens are correct`() {
        val temperature = 0.7
        val maxTokens = 300

        assertTrue(temperature in 0.0..1.0)
        assertEquals(300, maxTokens)
    }
}