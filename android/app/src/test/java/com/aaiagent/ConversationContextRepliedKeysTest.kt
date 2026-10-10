package com.aaiagent

import com.aaiagent.engine.ConversationContext
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationContextRepliedKeysTest {
    @Test
    fun `remembers an answered incoming message`() {
        val context = ConversationContext(platform = "soul", contactId = "张三")
        assertFalse(context.hasRepliedToIncoming("id:abc"))
        context.rememberRepliedIncoming("id:abc")
        assertTrue(context.hasRepliedToIncoming("id:abc"))
    }

    @Test
    fun `ignores blank keys`() {
        val context = ConversationContext(platform = "soul", contactId = "张三")
        context.rememberRepliedIncoming("   ")
        assertFalse(context.hasRepliedToIncoming(""))
        assertTrue(context.repliedIncomingKeys.isEmpty())
    }

    @Test
    fun `keeps the tracked keys bounded`() {
        val context = ConversationContext(platform = "soul", contactId = "张三")
        repeat(ConversationContext.MAX_TRACKED_INCOMING_KEYS + 5) { index ->
            context.rememberRepliedIncoming("id:" + index)
        }
        assertTrue(context.repliedIncomingKeys.size <= ConversationContext.MAX_TRACKED_INCOMING_KEYS)
        assertTrue(context.hasRepliedToIncoming("id:" + (ConversationContext.MAX_TRACKED_INCOMING_KEYS + 4)))
    }
}
