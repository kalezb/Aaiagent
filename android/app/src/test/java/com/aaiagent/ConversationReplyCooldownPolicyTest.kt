package com.aaiagent

import com.aaiagent.engine.ConversationReplyCooldownPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationReplyCooldownPolicyTest {
    @Test
    fun blocksOnlyTheFailedContactUntilTheCooldownExpires() {
        val policy = ConversationReplyCooldownPolicy()
        val now = 1_000_000L

        policy.block("墨染清秋", ConversationReplyCooldownPolicy.UPSTREAM_ERROR_BLOCK_MS, now)

        assertTrue(policy.isBlocked("墨染清秋", now + 1_000L))
        assertFalse(policy.isBlocked("其他联系人", now + 1_000L))
        assertFalse(
            policy.isBlocked(
                "墨染清秋",
                now + ConversationReplyCooldownPolicy.UPSTREAM_ERROR_BLOCK_MS + 1L
            )
        )
    }

    @Test
    fun ignoresBlankKeys() {
        val policy = ConversationReplyCooldownPolicy()
        policy.block("  ", 60_000L, 1_000L)

        assertFalse(policy.isBlocked("", 2_000L))
    }
}
