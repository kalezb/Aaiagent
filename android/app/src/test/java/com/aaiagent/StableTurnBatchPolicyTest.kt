package com.aaiagent

import com.aaiagent.engine.ReplyFreshnessPolicy
import org.junit.Assert.assertTrue
import org.junit.Test

class StableTurnBatchPolicyTest {
    @Test
    fun `every turn gets a second page read before generation`() {
        assertTrue(ReplyFreshnessPolicy.shouldConfirmStableBatch())
    }
}
