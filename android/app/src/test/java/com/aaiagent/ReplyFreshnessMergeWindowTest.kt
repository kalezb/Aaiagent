package com.aaiagent

import com.aaiagent.engine.ReplyFreshnessPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyFreshnessMergeWindowTest {
    @Test
    fun `waits while the message was just sent`() {
        assertTrue(ReplyFreshnessPolicy.shouldWaitForMerge(0L))
        assertTrue(ReplyFreshnessPolicy.shouldWaitForMerge(1_200L))
        assertTrue(ReplyFreshnessPolicy.shouldWaitForMerge(2_999L))
    }

    @Test
    fun `does not wait for messages that are already a while old`() {
        // 回几分钟甚至几小时前的未读时，等合并窗口纯属白等 2.5~5 秒
        assertFalse(ReplyFreshnessPolicy.shouldWaitForMerge(3_000L))
        assertFalse(ReplyFreshnessPolicy.shouldWaitForMerge(45_000L))
        assertFalse(ReplyFreshnessPolicy.shouldWaitForMerge(Long.MAX_VALUE))
    }

    @Test
    fun `treats clock skew as fresh so behaviour stays conservative`() {
        assertTrue(ReplyFreshnessPolicy.shouldWaitForMerge(-1L))
    }
}
