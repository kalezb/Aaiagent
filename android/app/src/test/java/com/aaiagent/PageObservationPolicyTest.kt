package com.aaiagent

import com.aaiagent.adapter.PageObservationPolicy
import com.aaiagent.adapter.PageObservationSignals
import com.aaiagent.engine.observability.AutomationPageKind
import org.junit.Assert.assertEquals
import org.junit.Test

class PageObservationPolicyTest {
    @Test
    fun `chat surface has priority`() {
        val page = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = true,
                inMessageList = false,
                hasChatInput = true,
                hasChatTitle = true,
                profileMarkerCount = 0,
                chatTitle = "联系人A",
            )
        )

        assertEquals(AutomationPageKind.VERIFIED_CHAT, page.kind)
        assertEquals("联系人A", page.contactName)
    }

    @Test
    fun `visible profile markers win over stale message list nodes`() {
        val page = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = false,
                inMessageList = true,
                hasChatInput = false,
                hasChatTitle = false,
                profileMarkerCount = 3,
            )
        )

        assertEquals(AutomationPageKind.PROFILE_PAGE, page.kind)
    }

    @Test
    fun `profile page wins over stale chat controls`() {
        val profile = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = false,
                inMessageList = false,
                hasChatInput = false,
                hasChatTitle = false,
                profileMarkerCount = 3,
                profileName = "联系人A",
                windowClassName = "cn.soulapp.android.component.home.user.UserHomeActivity",
            )
        )
        val unknown = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = true,
                inMessageList = false,
                hasChatInput = true,
                hasChatTitle = true,
                profileMarkerCount = 3,
                chatTitle = "联系人A",
                windowClassName = "cn.soulapp.android.component.home.user.UserHomeActivity",
            )
        )

        assertEquals(AutomationPageKind.PROFILE_PAGE, profile.kind)
        assertEquals("联系人A", profile.contactName)
        assertEquals(AutomationPageKind.PROFILE_PAGE, unknown.kind)
    }

    @Test
    fun `short chat relation card does not become a profile page`() {
        val page = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = true,
                inMessageList = false,
                hasChatInput = true,
                hasChatTitle = true,
                profileMarkerCount = 9,
                profileName = "Souler",
                chatTitle = "路过",
                windowClassName = "cn.soulapp.android.component.chat.ConversationActivity",
            )
        )

        assertEquals(AutomationPageKind.VERIFIED_CHAT, page.kind)
        assertEquals("路过", page.contactName)
    }

    @Test
    fun `conversation activity without chat controls still reports profile`() {
        val page = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = false,
                inMessageList = false,
                hasChatInput = false,
                hasChatTitle = false,
                profileMarkerCount = 3,
                profileName = "路过",
                windowClassName = "cn.soulapp.android.component.chat.ConversationActivity",
            )
        )

        assertEquals(AutomationPageKind.PROFILE_PAGE, page.kind)
        assertEquals("路过", page.contactName)
    }

    @Test
    fun `one weak marker does not turn a chat page into a profile page`() {
        val chat = PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = true,
                inMessageList = false,
                hasChatInput = true,
                hasChatTitle = true,
                profileMarkerCount = 1,
                chatTitle = "联系人A",
            )
        )

        assertEquals(AutomationPageKind.VERIFIED_CHAT, chat.kind)
    }
}
