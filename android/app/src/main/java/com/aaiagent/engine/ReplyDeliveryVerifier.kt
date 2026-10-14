package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.delay

internal class ReplyDeliveryVerifier(
    private val rootProvider: () -> AccessibilityNodeInfo?,
    private val isIdentityConfirmed: (
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        expectedContactName: String,
    ) -> Boolean,
) {
    suspend fun verifyCurrentChatWithRetry(
        adapter: PlatformAdapter,
        expectedContactName: String,
        retries: Int = OUTGOING_VERIFY_RETRIES,
        retryDelayMs: Long = OUTGOING_VERIFY_RETRY_DELAY_MS,
    ): Boolean {
        repeat(retries) { attempt ->
            if (verifyCurrentChat(adapter, expectedContactName)) return true
            if (attempt < retries - 1) delay(retryDelayMs)
        }
        return false
    }

    suspend fun verifyOutgoingPartVisible(
        adapter: PlatformAdapter,
        context: ConversationContext,
        expectedContent: String,
        retries: Int = OUTGOING_VERIFY_RETRIES,
        retryDelayMs: Long = OUTGOING_VERIFY_RETRY_DELAY_MS,
    ): Boolean {
        repeat(retries) { attempt ->
            val root = rootProvider()
            if (root != null &&
                root.packageName?.toString() == adapter.packageName &&
                adapter.isInChat(root) &&
                isIdentityConfirmed(adapter, root, context.contactName)
            ) {
                if (ReplyDeliveryVerificationPolicy.isOutgoingVisible(
                        messages = adapter.readMessages(root),
                        expectedContent = expectedContent,
                    )
                ) return true
            }
            if (attempt < retries - 1) delay(retryDelayMs)
        }
        return false
    }

    fun verifyCurrentChat(
        adapter: PlatformAdapter,
        expectedContactName: String,
    ): Boolean {
        val root = rootProvider() ?: return false
        if (root.packageName?.toString() != adapter.packageName) return false
        return isIdentityConfirmed(adapter, root, expectedContactName)
    }

    suspend fun incomingStillCurrent(
        adapter: PlatformAdapter,
        context: ConversationContext,
        expectedFingerprint: String,
    ): Boolean {
        if (expectedFingerprint.isBlank()) return false
        repeat(INCOMING_VERIFY_RETRIES) { attempt ->
            val root = rootProvider() ?: return false
            if (root.packageName?.toString() != adapter.packageName || !adapter.isInChat(root)) {
                return false
            }
            if (!isIdentityConfirmed(adapter, root, context.contactName)) return false
            val current = IncomingMessageBatch.incomingHistoryFingerprint(
                withoutOwnBubbles(context, adapter.readMessages(root))
            )
            if (current.isNotBlank()) {
                return !ReplyDeliveryPolicy.incomingChanged(expectedFingerprint, current)
            }
            if (attempt < INCOMING_VERIFY_RETRIES - 1) {
                delay(INCOMING_VERIFY_RETRY_DELAY_MS)
            }
        }
        return true
    }

    internal fun withoutOwnBubbles(
        context: ConversationContext,
        messages: List<PlatformAdapter.ChatMessage>,
    ): List<PlatformAdapter.ChatMessage> {
        val own = synchronized(context) { context.aiSentContents.toSet() }
        if (own.isEmpty()) return messages
        return messages.filterNot { message ->
            UndetectedOwnBubblePolicy.isOwnBubble(
                sender = message.sender,
                type = message.type,
                content = message.content,
                sentByAutomation = own,
            )
        }
    }

    private companion object {
        const val INCOMING_VERIFY_RETRIES = 3
        const val INCOMING_VERIFY_RETRY_DELAY_MS = 150L
        const val OUTGOING_VERIFY_RETRIES = 3
        const val OUTGOING_VERIFY_RETRY_DELAY_MS = 250L
    }
}
