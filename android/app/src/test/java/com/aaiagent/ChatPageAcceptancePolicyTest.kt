package com.aaiagent

import com.aaiagent.engine.ChatPageAcceptancePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatPageAcceptancePolicyTest {
    @Test
    fun acceptsWhenTheInputBarIsVisible() {
        assertTrue(ChatPageAcceptancePolicy.accept(inChat = true, titleMatchesContact = false))
    }

    @Test
    fun acceptsWhenOnlyTheChatTitleMatches() {
        // Soul can hide the input bar behind a transient panel while the chat
        // title already proves we are in the right conversation.
        assertTrue(ChatPageAcceptancePolicy.accept(inChat = false, titleMatchesContact = true))
    }

    @Test
    fun rejectsWhenNeitherSignalMatches() {
        assertFalse(ChatPageAcceptancePolicy.accept(inChat = false, titleMatchesContact = false))
    }
}
