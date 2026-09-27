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
    fun `new or disappearing incoming history invalidates a pending reply`() {
        assertTrue(ReplyDeliveryPolicy.incomingChanged("old", "new"))
        assertTrue(ReplyDeliveryPolicy.incomingChanged("old", ""))
        assertFalse(ReplyDeliveryPolicy.incomingChanged("same", "same"))
    }

    @Test
    fun `follow-up bubbles use short fast typing delays`() {
        assertEquals(200L, ReplyDeliveryPolicy.delayAfterPart("短句", 0.0))
        assertEquals(500L, ReplyDeliveryPolicy.delayAfterPart("短句", 1.0))
        assertEquals(600L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 0.0))
        assertEquals(1000L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 1.0))
    }
}
