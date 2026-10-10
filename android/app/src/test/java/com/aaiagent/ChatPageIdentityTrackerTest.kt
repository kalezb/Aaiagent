package com.aaiagent

import com.aaiagent.engine.ChatPageIdentityDecision
import com.aaiagent.engine.ChatPageIdentityTracker
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatPageIdentityTrackerTest {
    @Test
    fun `exact title confirms the chat window`() {
        val tracker = ChatPageIdentityTracker()

        val decision = tracker.observe(
            windowId = 100,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "IOTO",
            previewMatches = false,
        )

        assertEquals(ChatPageIdentityDecision.CONFIRMED, decision)
    }

    @Test
    fun `typing status is allowed after exact name was seen in the same window`() {
        val tracker = ChatPageIdentityTracker()
        tracker.rememberConfirmedTitle(
            windowId = 100,
            expectedContact = "IOTO",
            actualTitle = "IOTO",
        )

        val decision = tracker.observe(
            windowId = 100,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "正在输入...",
            previewMatches = false,
        )

        assertEquals(ChatPageIdentityDecision.CONFIRMED, decision)
    }

    @Test
    fun `typing status without exact name is read only when preview matches`() {
        val tracker = ChatPageIdentityTracker()

        val decision = tracker.observe(
            windowId = 100,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "正在输入...",
            previewMatches = true,
        )

        assertEquals(ChatPageIdentityDecision.READ_ONLY, decision)
    }

    @Test
    fun `typing status without exact name cannot be used for sending`() {
        val tracker = ChatPageIdentityTracker()

        val decision = tracker.observe(
            windowId = 100,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "正在输入...",
            previewMatches = false,
        )

        assertEquals(ChatPageIdentityDecision.WAIT, decision)
    }

    @Test
    fun `a different window loses the cached name`() {
        val tracker = ChatPageIdentityTracker()
        tracker.rememberConfirmedTitle(
            windowId = 100,
            expectedContact = "IOTO",
            actualTitle = "IOTO",
        )

        val decision = tracker.observe(
            windowId = 200,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "正在输入...",
            previewMatches = false,
        )

        assertEquals(ChatPageIdentityDecision.WAIT, decision)
    }

    @Test
    fun `another contact name overrides a cached name`() {
        val tracker = ChatPageIdentityTracker()
        tracker.rememberConfirmedTitle(
            windowId = 100,
            expectedContact = "IOTO",
            actualTitle = "IOTO",
        )

        val decision = tracker.observe(
            windowId = 100,
            inChat = true,
            expectedContact = "IOTO",
            actualTitle = "小王",
            previewMatches = true,
        )

        assertEquals(ChatPageIdentityDecision.WAIT, decision)
    }

    @Test
    fun `leaving chat is not accepted`() {
        val tracker = ChatPageIdentityTracker()

        val decision = tracker.observe(
            windowId = 100,
            inChat = false,
            expectedContact = "IOTO",
            actualTitle = "IOTO",
            previewMatches = true,
        )

        assertEquals(ChatPageIdentityDecision.NOT_CHAT, decision)
    }
}
