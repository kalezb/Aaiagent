package com.aaiagent

import com.aaiagent.engine.AutomationLease
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.IncomingMessageTracker
import com.aaiagent.engine.ReplyFormatter
import com.aaiagent.engine.ReplyFreshnessDecision
import com.aaiagent.engine.ReplyFreshnessPolicy
import com.aaiagent.engine.UserInteractionGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageEngineTest {
    @Test
    fun `lease only belongs to the latest owner`() {
        var now = 1_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "token-${now}" })

        val first = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(first))

        now += 100L
        val second = lease.acquire(ttlMs = 500L)
        assertTrue(lease.owns(second))
        assertFalse(lease.owns(first))

        now += 501L
        assertFalse(lease.owns(second))
    }

    @Test
    fun `lease can renew and revoke`() {
        var now = 10_000L
        val lease = AutomationLease(clock = { now }, tokenFactory = { "lease" })
        val token = lease.acquire(ttlMs = 500L)

        now += 400L
        assertTrue(lease.renew(token, ttlMs = 500L))
        now += 400L
        assertTrue(lease.owns(token))

        lease.revoke()
        assertFalse(lease.owns(token))
    }

    @Test
    fun `automation events do not count as manual takeover`() {
        var now = 5_000L
        val gate = UserInteractionGate(clock = { now })

        gate.onAutomationActionStarted(protectionMs = 1_000L)
        assertFalse(gate.onAccessibilityInteraction())

        now += 1_001L
        assertTrue(gate.onAccessibilityInteraction())
        assertTrue(gate.shouldPause(windowMs = 5_000L))

        now += 5_001L
        assertFalse(gate.shouldPause(windowMs = 5_000L))
    }

    @Test
    fun `manual takeover increments interaction epoch once`() {
        var now = 1_000L
        val gate = UserInteractionGate(clock = { now })

        assertEquals(0L, gate.interactionEpoch())
        assertTrue(gate.onAccessibilityInteraction())
        assertEquals(1L, gate.interactionEpoch())

        gate.onAutomationActionStarted(protectionMs = 500L)
        assertFalse(gate.onAccessibilityInteraction())
        assertEquals(1L, gate.interactionEpoch())
    }

    @Test
    fun `conversation identity accepts safe title variations`() {
        assertTrue(ConversationIdentity.matches("星暮", "星暮"))
        assertTrue(ConversationIdentity.matches("小明同学", "小明同学 在线"))
        assertFalse(ConversationIdentity.matches("小明", "小明明"))
        assertFalse(ConversationIdentity.matches("unknown", "小明"))
        assertFalse(ConversationIdentity.matches("", "小明"))
    }

    @Test
    fun `reply freshness forces send after deadline`() {
        assertEquals(
            ReplyFreshnessDecision.KEEP,
            ReplyFreshnessPolicy.decide(2, 2, 0, 1_000L, 2_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.RECOMPUTE,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 2_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.FORCE_SEND,
            ReplyFreshnessPolicy.decide(2, 3, 0, 1_000L, 10_000L)
        )
        assertEquals(
            ReplyFreshnessDecision.FORCE_SEND,
            ReplyFreshnessPolicy.decide(2, 3, 3, 1_000L, 2_000L)
        )
    }

    @Test
    fun `reply formatter removes punctuation and splits short sentences`() {
        assertEquals(
            listOf("在的", "刚忙完", "你周末有空吗", "我想约你出来吃饭"),
            ReplyFormatter.formatForSending("在的，刚忙完。你周末有空吗？我想约你出来吃饭。")
        )
        assertEquals(
            listOf("你好呀"),
            ReplyFormatter.formatForSending("你好呀")
        )
        assertEquals(
            listOf("一 二 三 四 五 六"),
            ReplyFormatter.formatForSending("一。二。三。四。五。六。")
        )
    }

    @Test
    fun `reply formatter keeps a short reply together`() {
        assertEquals(listOf("好的", "马上"), ReplyFormatter.formatForSending("好的，马上。"))
    }

    @Test
    fun `reply formatter prefers backend short sentence separators`() {
        assertEquals(
            listOf("在的", "刚忙完", "你周末有空吗", "出来吃个饭吗"),
            ReplyFormatter.formatForSending("在的 刚忙完|||你周末有空吗|||出来吃个饭吗")
        )
    }

    @Test
    fun `reply formatter splits a long comma sentence`() {
        assertEquals(
            listOf("今天刚从重庆回来", "路上有点堵", "晚点再跟你聊"),
            ReplyFormatter.formatForSending("今天刚从重庆回来，路上有点堵，晚点再跟你聊")
        )
    }

    @Test
    fun `reply formatter turns model pauses into separate messages`() {
        assertEquals(
            listOf("咋啦", "发这么一串问号"),
            ReplyFormatter.formatForSending("咋啦 发这么一串问号")
        )
    }
}
