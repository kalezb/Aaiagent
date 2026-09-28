package com.aaiagent

import com.aaiagent.engine.TemporaryLeavePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TemporaryLeavePolicyTest {
    @Test
    fun `going to shower starts a realistic cooldown`() {
        val decision = TemporaryLeavePolicy.detect("洗漱去了，一会儿聊", randomUnit = 0.5)

        assertNotNull(decision)
        assertEquals("洗漱", decision?.reason)
        assertEquals(24 * 60_000L, decision?.durationMs)
    }

    @Test
    fun `future wash phrase is detected even though it contains wash words`() {
        val decision = TemporaryLeavePolicy.detect("我先去洗澡，洗完再聊", randomUnit = 0.0)

        assertEquals("洗漱", decision?.reason)
        assertEquals(18 * 60_000L, decision?.durationMs)
    }

    @Test
    fun `past completed actions do not start cooldown`() {
        assertNull(TemporaryLeavePolicy.detect("我刚洗完澡"))
        assertNull(TemporaryLeavePolicy.detect("刚忙完，回来了"))
    }

    @Test
    fun `sleep questions and wakeful messages do not start cooldown`() {
        assertNull(TemporaryLeavePolicy.detect("睡了没"))
        assertNull(TemporaryLeavePolicy.detect("你睡了吗"))
        assertNull(TemporaryLeavePolicy.detect("睡了，但是没完全睡着"))
        assertFalse(TemporaryLeavePolicy.shouldWaitForNextIncoming("睡了没"))
        assertFalse(TemporaryLeavePolicy.shouldWaitForNextIncoming("睡了，但是没完全睡着"))
    }

    @Test
    fun `busy meal outing and sleep have separate cooldowns`() {
        assertEquals("忙碌", TemporaryLeavePolicy.detect("我去忙了，回头聊")?.reason)
        assertEquals("吃饭", TemporaryLeavePolicy.detect("先去吃饭，晚点聊")?.reason)
        assertEquals("外出", TemporaryLeavePolicy.detect("我出门了，等会儿聊")?.reason)
        assertEquals("休息", TemporaryLeavePolicy.detect("我先睡了，明早聊")?.reason)
    }

    @Test
    fun `generic defer gets a short cooldown`() {
        val decision = TemporaryLeavePolicy.detect("晚点聊", randomUnit = 0.0)

        assertEquals("稍后聊", decision?.reason)
        assertEquals(8 * 60_000L, decision?.durationMs)
    }

    @Test
    fun `other person farewell waits for a new incoming message`() {
        assertTrue(TemporaryLeavePolicy.shouldWaitForNextIncoming("洗澡去了 回聊"))
        assertTrue(TemporaryLeavePolicy.shouldWaitForNextIncoming("我去忙了 晚点聊"))
        assertFalse(TemporaryLeavePolicy.shouldWaitForNextIncoming("我刚洗完澡"))
        assertFalse(TemporaryLeavePolicy.shouldWaitForNextIncoming("你几点去洗澡？"))
    }
}
