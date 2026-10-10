package com.aaiagent

import com.aaiagent.engine.ConversationReplyPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationReplyPolicyTest {
    @Test
    fun `incoming last message needs a reply`() {
        assertTrue(ConversationReplyPolicy.shouldReply("other"))
    }

    @Test
    fun `self last message is already answered`() {
        assertFalse(ConversationReplyPolicy.shouldReply("self"))
    }

    @Test
    fun `empty conversation does not need a reply`() {
        assertFalse(ConversationReplyPolicy.shouldReply(null))
        assertFalse(ConversationReplyPolicy.shouldReply(""))
    }
}
