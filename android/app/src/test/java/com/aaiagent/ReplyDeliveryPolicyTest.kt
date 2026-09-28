package com.aaiagent

import com.aaiagent.engine.ReplyDeliveryPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyDeliveryPolicyTest {
    @Test
    fun `all parts must be sent before reply is complete`() {
        val partial = ReplyDeliveryPolicy.progress(sentParts = 1, totalParts = 3)
        val complete = ReplyDeliveryPolicy.progress(sentParts = 3, totalParts = 3)

        assertTrue(partial.isPartial)
        assertFalse(partial.isComplete)
        assertTrue(complete.isComplete)
        assertFalse(complete.isPartial)
    }

    @Test
    fun `partial delivery keeps the unsent tail for retry`() {
        val parts = listOf("第一句", "第二句", "第三句")

        assertEquals(listOf("第二句", "第三句"), ReplyDeliveryPolicy.remaining(parts, sentParts = 1))
        assertEquals(emptyList<String>(), ReplyDeliveryPolicy.remaining(parts, sentParts = 3))
    }

    @Test
    fun `natural short replies are not padded to three parts`() {
        assertEquals(listOf("在的"), ReplyDeliveryPolicy.prepareParts(listOf("在的")))
        assertEquals(
            listOf("在的", "刚忙完"),
            ReplyDeliveryPolicy.prepareParts(listOf("在的", "刚忙完"))
        )
    }

    @Test
    fun `more than three parts are compacted instead of sent as a long burst`() {
        assertEquals(
            listOf("一", "二", "三 四 五"),
            ReplyDeliveryPolicy.prepareParts(listOf("一", "二", "三", "四", "五"))
        )
    }

    @Test
    fun `random planning can send one two or three natural bubbles`() {
        assertEquals(
            listOf("一 二 三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.1)
        )
        assertEquals(
            listOf("一", "二 三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.5)
        )
        assertEquals(
            listOf("一", "二", "三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.95)
        )
    }

    @Test
    fun `two model parts can still be sent as one short reply`() {
        assertEquals(
            listOf("在的 刚忙完"),
            ReplyDeliveryPolicy.planParts(listOf("在的", "刚忙完"), randomUnit = 0.2)
        )
    }

    @Test
    fun `long single reply can use a random natural bubble count`() {
        val longReply = "在的 刚忙完 你想聊什么就直说 我看到消息会回你 不用一直等我"
        val onePart = ReplyDeliveryPolicy.planParts(listOf(longReply), randomUnit = 0.1)
        val parts = ReplyDeliveryPolicy.planParts(listOf(longReply), randomUnit = 0.95)

        assertEquals(listOf(longReply), onePart)
        assertTrue(parts.size in 2..3)
        assertTrue(parts.all { it.length <= 24 })
        assertEquals(longReply.replace(" ", ""), parts.joinToString("").replace(" ", ""))
    }

    @Test
    fun `short reply is not split just to imitate typing`() {
        assertEquals(listOf("不语音哈 打字可以"), ReplyDeliveryPolicy.planParts(listOf("不语音哈 打字可以")))
    }

    @Test
    fun `new incoming history invalidates while a transient empty read does not`() {
        assertTrue(ReplyDeliveryPolicy.incomingChanged("old", "new"))
        assertFalse(ReplyDeliveryPolicy.incomingChanged("old", ""))
        assertFalse(ReplyDeliveryPolicy.incomingChanged("same", "same"))
    }

    @Test
    fun `recomputed reply fingerprints replace the stale original`() {
        assertEquals("fresh", ReplyDeliveryPolicy.effectiveFingerprint("fresh", "old"))
        assertEquals("old", ReplyDeliveryPolicy.effectiveFingerprint(null, "old"))
        assertEquals("old", ReplyDeliveryPolicy.effectiveFingerprint("", "old"))
    }

    @Test
    fun `follow-up bubbles use short fast typing delays`() {
        assertEquals(200L, ReplyDeliveryPolicy.delayAfterPart("短句", 0.0))
        assertEquals(500L, ReplyDeliveryPolicy.delayAfterPart("短句", 1.0))
        assertEquals(600L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 0.0))
        assertEquals(1000L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 1.0))
    }
}
