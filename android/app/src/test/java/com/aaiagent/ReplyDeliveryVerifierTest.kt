package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.ConversationContext
import com.aaiagent.engine.ReplyDeliveryVerifier
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ReplyDeliveryVerifierTest {
    @Test
    fun `without own bubbles keeps incoming messages only`() {
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
        )
        context.rememberAutomatedReply("已经发过的话")
        val verifier = verifier(root = null)
        val messages = listOf(
            PlatformAdapter.ChatMessage(sender = "我", content = "已经发过的话"),
            PlatformAdapter.ChatMessage(sender = "梦想", content = "你吃饭了吗"),
        )

        val filtered = verifier.withoutOwnBubbles(context, messages)

        assertEquals(listOf("你吃饭了吗"), filtered.map { it.content })
    }

    @Test
    fun `missing root cannot verify current chat`() {
        val verifier = verifier(root = null)

        assertFalse(verifier.verifyCurrentChat(fakeAdapter(), "梦想"))
    }

    @Test
    fun `blank incoming fingerprint is never considered current`() = runBlocking {
        val verifier = verifier(root = null)

        assertFalse(
            verifier.incomingStillCurrent(
                adapter = fakeAdapter(),
                context = ConversationContext("soul", "contact-1"),
                expectedFingerprint = "",
            )
        )
    }

    private fun verifier(root: android.view.accessibility.AccessibilityNodeInfo?): ReplyDeliveryVerifier {
        return ReplyDeliveryVerifier(
            rootProvider = { root },
            isIdentityConfirmed = { _, _, _ -> false },
        )
    }

    private fun fakeAdapter(): PlatformAdapter {
        return object : PlatformAdapter {
            override val packageName: String = "cn.soulapp.android"
            override fun isInChat(root: android.view.accessibility.AccessibilityNodeInfo): Boolean = false
            override fun isInMessageList(root: android.view.accessibility.AccessibilityNodeInfo): Boolean = false
            override fun readMessages(root: android.view.accessibility.AccessibilityNodeInfo) =
                emptyList<PlatformAdapter.ChatMessage>()
            override suspend fun fillAndSend(
                service: android.accessibilityservice.AccessibilityService,
                root: android.view.accessibility.AccessibilityNodeInfo,
                text: String,
                expectedContactName: String?,
            ) = PlatformAdapter.SendResult.SUCCESS
            override suspend fun clickFirstUnreadConversation(
                root: android.view.accessibility.AccessibilityNodeInfo,
                shouldClick: Boolean,
                contactFilter: suspend (String, String) -> Boolean,
            ) = null
            override suspend fun navigateToMessageList(
                service: android.accessibilityservice.AccessibilityService,
                root: android.view.accessibility.AccessibilityNodeInfo,
            ) = true
            override suspend fun bringToForeground(
                service: android.accessibilityservice.AccessibilityService,
            ) = Unit
        }
    }
}
