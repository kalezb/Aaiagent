package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.ConversationReadIdentityPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationReadIdentityPolicyTest {
    @Test
    fun `stable ledger key wins and plain content remains readable`() {
        assertEquals(
            "ledger:stable-1",
            ConversationReadIdentityPolicy.incomingContentKey(
                ChatMessage("other", "在吗", ledgerKey = "stable-1")
            ),
        )
        assertEquals(
            "other|text|晚上一起吃饭",
            ConversationReadIdentityPolicy.incomingContentKey(
                ChatMessage("other", " 晚上一起吃饭 ")
            ),
        )
    }
}
