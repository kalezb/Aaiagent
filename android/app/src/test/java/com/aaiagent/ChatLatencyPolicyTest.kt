package com.aaiagent

import com.aaiagent.engine.ChatLatencyPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatLatencyPolicyTest {
    @Test
    fun `slow warning starts at ten seconds`() {
        assertFalse(ChatLatencyPolicy.isSlow(9_999L))
        assertTrue(ChatLatencyPolicy.isSlow(10_000L))
        assertTrue(ChatLatencyPolicy.isSlow(13_000L))
    }
}
