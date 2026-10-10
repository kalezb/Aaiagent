package com.aaiagent

import com.aaiagent.adapter.SoulProfileSurfacePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulProfileSurfacePolicyTest {
    private val chatWindow =
        "cn.soulapp.android.component.chat.ConversationActivity"
    private val profileWindow =
        "cn.soulapp.android.component.home.user.UserHomeActivity"

    @Test
    fun `profile markers inside a live short chat stay chat`() {
        assertFalse(
            SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
                profileMarkerCount = 9,
                hasChatInput = true,
                hasChatTitle = true,
                windowClassName = chatWindow,
            )
        )
    }

    @Test
    fun `known profile window wins over stale chat controls`() {
        assertTrue(
            SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
                profileMarkerCount = 3,
                hasChatInput = true,
                hasChatTitle = true,
                windowClassName = profileWindow,
            )
        )
    }

    @Test
    fun `profile markers without chat controls still report profile`() {
        assertTrue(
            SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
                profileMarkerCount = 3,
                hasChatInput = false,
                hasChatTitle = false,
                windowClassName = chatWindow,
            )
        )
    }

    @Test
    fun `one marker is never enough`() {
        assertFalse(
            SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
                profileMarkerCount = 1,
                hasChatInput = false,
                hasChatTitle = false,
                windowClassName = profileWindow,
            )
        )
    }
}
