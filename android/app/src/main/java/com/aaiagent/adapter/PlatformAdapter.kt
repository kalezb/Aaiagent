package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

interface PlatformAdapter {
    val packageName: String

    fun isInChat(root: AccessibilityNodeInfo): Boolean
    fun isInMessageList(root: AccessibilityNodeInfo): Boolean
    fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage>

    /**
     * Reads the visible title of the current chat. Returning null is safer than
     * guessing because the engine will skip a conversation it cannot verify.
     */
    fun readChatTitle(root: AccessibilityNodeInfo): String? = null

    /** Returns the on-screen bounds of the latest visual message, if any. */
    fun readVisualTargetBounds(
        root: AccessibilityNodeInfo,
        targetType: String? = null
    ): android.graphics.Rect? = null
    /**
     * Opens a protected visual message when the platform requires an explicit reveal.
     * Returning null means the target cannot be prepared and must not be captured.
     */
    suspend fun prepareVisualCapture(
        root: AccessibilityNodeInfo,
        targetType: String? = null
    ): VisualCapturePreparation? {
        return VisualCapturePreparation(root)
    }

    /** Restores the chat view after a prepared visual capture. */
    suspend fun finishVisualCapture(root: AccessibilityNodeInfo) = Unit

    /**
     * Converts every unanswered voice message in the current chat into text.
     * Adapters without native transcription can keep the empty result.
     */
    suspend fun transcribeIncomingVoices(
        root: AccessibilityNodeInfo
    ): VoiceTranscriptionResult = VoiceTranscriptionResult()

    /**
     * Lightweight list fingerprint used to wait for list animations to settle.
     */
    fun listSnapshot(root: AccessibilityNodeInfo): ListSnapshot = ListSnapshot()

    /**
     * Scrolls the conversation list. Adapters that do not support scrolling can
     * keep the default implementation.
     */
    fun scrollConversationList(root: AccessibilityNodeInfo, direction: ScrollDirection): Boolean = false

    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String? = null
    ): SendResult

    suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean = true
    ): ConversationInfo?

    suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo)
    suspend fun bringToForeground(service: AccessibilityService)

    data class ChatMessage(
        val sender: String,
        val content: String,
        val type: String = "text"
    )

    data class ConversationInfo(
        val contactId: String,
        val contactName: String,
        val preview: String
    )

    data class MessageInfo(
        val id: String,
        val content: String,
        val sender: String = "",
        val timestamp: Long = System.currentTimeMillis()
    )

    data class ListSnapshot(
        val itemCount: Int = 0,
        val firstConversation: String = "",
        val lastConversation: String = ""
    )

    data class VisualCapturePreparation(
        val root: AccessibilityNodeInfo,
        val privacyProtected: Boolean = false
    )

    data class VoiceTranscriptionResult(
        val total: Int = 0,
        val transcribed: Int = 0
    ) {
        val hasAny: Boolean get() = transcribed > 0
        val isComplete: Boolean get() = total > 0 && transcribed == total
        val isPartial: Boolean get() = transcribed in 1 until total
    }

    enum class ScrollDirection {
        FORWARD,
        BACKWARD
    }

    enum class SendResult {
        SUCCESS,
        BANNED,
        TIMEOUT,
        NOT_VERIFIED
    }
}
