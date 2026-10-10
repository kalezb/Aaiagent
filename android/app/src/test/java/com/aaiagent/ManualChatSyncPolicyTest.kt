package com.aaiagent

import com.aaiagent.engine.ManualChatSyncPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualChatSyncPolicyTest {
    @Test
    fun `manual sync captures only a stable non-hosting chat`() {
        assertTrue(
            ManualChatSyncPolicy.shouldCapture(
                hostingEnabled = false,
                inChat = true,
                title = "C",
                messageCount = 3,
            )
        )
        assertFalse(
            ManualChatSyncPolicy.shouldCapture(
                hostingEnabled = true,
                inChat = true,
                title = "C",
                messageCount = 3,
            )
        )
        assertFalse(
            ManualChatSyncPolicy.shouldCapture(
                hostingEnabled = false,
                inChat = false,
                title = "C",
                messageCount = 3,
            )
        )
        assertFalse(
            ManualChatSyncPolicy.shouldCapture(
                hostingEnabled = false,
                inChat = true,
                title = " ",
                messageCount = 3,
            )
        )
    }

    @Test
    fun `manual sync jobs are isolated per conversation slot`() {
        assertEquals(
            ManualChatSyncPolicy.slotKey("SOUL", "A"),
            ManualChatSyncPolicy.slotKey("soul", " A "),
        )
        assertNotEquals(
            ManualChatSyncPolicy.slotKey("soul", "A"),
            ManualChatSyncPolicy.slotKey("soul", "B"),
        )
    }
}
