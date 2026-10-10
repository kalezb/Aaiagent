package com.aaiagent

import com.aaiagent.adapter.SoulConversationScanPolicy
import org.junit.Assert.assertFalse
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

    @Test
    fun `fallback bubbles only apply when a large page has no strict message content`() {
        assertTrue(
            SoulConversationScanPolicy.shouldUseFallbackBubbles(
                itemCount = 8,
                strictContentCount = 0,
                minItemsForStrictCheck = 3,
            )
        )
        assertFalse(
            SoulConversationScanPolicy.shouldUseFallbackBubbles(
                itemCount = 8,
                strictContentCount = 2,
                minItemsForStrictCheck = 3,
            )
        )
        assertFalse(
            SoulConversationScanPolicy.shouldUseFallbackBubbles(
                itemCount = 2,
                strictContentCount = 0,
                minItemsForStrictCheck = 3,
            )
        )
    }
}
