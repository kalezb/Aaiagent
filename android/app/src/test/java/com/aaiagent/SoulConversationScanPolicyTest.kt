package com.aaiagent

import com.aaiagent.adapter.SoulConversationScanPolicy
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulConversationScanPolicyTest {
    @Test
    fun `visible conversation rows are enough when bottom tab selected flag is missing`() {
        assertTrue(SoulConversationScanPolicy.isMessageList(
            conversationListVisible = true,
            searchVisible = false,
            visibleConversationCount = 6,
            chatTabSelected = false,
            bottomTabSelfSelected = false,
        ))
    }
}
