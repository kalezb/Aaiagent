package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.engine.ConversationStage
import com.aaiagent.engine.RelationshipOrigin

interface PlatformAdapter {
    val packageName: String

    fun isInChat(root: AccessibilityNodeInfo): Boolean
    fun isInMessageList(root: AccessibilityNodeInfo): Boolean
    fun hasTransientOverlay(root: AccessibilityNodeInfo): Boolean = false

    /** One shared page classification entry for tracing, navigation and send guards. */
    fun observePage(root: AccessibilityNodeInfo): PageObservation {
        val inChat = isInChat(root)
        val inMessageList = isInMessageList(root)
        return PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = inChat,
                inMessageList = inMessageList,
                hasChatInput = inChat,
                hasChatTitle = inChat,
                profileMarkerCount = 0,
            )
        )
    }
    /**
     * 读当前会话的消息。
     * expectedPreview = 列表那一行显示的最新预览；Soul 会把多个会话缓存在同一页里，
     * 用它挑出“最后一条能对上”的那一组，避免读到别的会话（2026-10-05 真机）。
     */
    fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage>

    /** 带列表预览的版本：Soul 会把多个会话缓存在同一页，用它挑出当前那一组。 */
    fun readMessages(root: AccessibilityNodeInfo, expectedPreview: String): List<ChatMessage> =
        readMessages(root)

    /** 聊天页最终阶段。列表标记只能作为来源提示，不能代替这个判断。 */
    fun detectConversationStage(root: AccessibilityNodeInfo): ConversationStage =
        ConversationStage.UNKNOWN

    fun onWindowStateChanged(className: String?) = Unit

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
        targetType: String? = null,
        exchangeImageBytes: ByteArray? = null
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

    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String? = null
    ): SendResult

    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String? = null,
        canProceed: () -> Boolean
    ): SendResult = fillAndSend(service, root, text, expectedContactName)

    /** Sends an in-memory image through the platform's native media picker. */
    suspend fun sendImage(
        service: AccessibilityService,
        expectedContactName: String?,
        imageBytes: ByteArray,
        fileName: String,
        contentType: String,
        canProceed: () -> Boolean
    ): SendResult = SendResult.TIMEOUT

    suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean = true,
        contactFilter: suspend (contactName: String, contactId: String) -> Boolean = { _, _ -> true }
    ): ConversationInfo?

    /** Read-only count used by the liveness watchdog. */
    fun visibleUnreadCount(root: AccessibilityNodeInfo): Int = 0

    suspend fun clickConversationByName(
        root: AccessibilityNodeInfo,
        contactName: String,
        shouldClick: Boolean = true,
        pageIndex: Int? = null,
        requireUnread: Boolean = false,
        expectedPreview: String = "",
    ): ConversationInfo? = null

    suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo): Boolean
    suspend fun bringToForeground(service: AccessibilityService)

    /**
     * Clears platform dialogs that block a verified chat before automation
     * reads or sends anything. Returning ready=false makes the engine leave
     * the chat and cool the contact down instead of retrying in a loop.
     */
    suspend fun prepareChatForAutomation(
        root: AccessibilityNodeInfo
    ): ChatPreparation = ChatPreparation(root)

    data class ChatMessage(
        val sender: String,
        val content: String,
        val type: String = "text",
        val timestampText: String = "",
        val timestampMillis: Long? = null,
        val identityKey: String = "",
        // 2026-10-07 方案A：语音的转写文字与时长单独带出去（内容里的身份锚点仍是 [语音]，不受影响）。
        val transcript: String = "",
        val voiceSeconds: Int = 0
    )

    data class ConversationInfo(
        val contactId: String,
        val contactName: String,
        val preview: String,
        val hasUnread: Boolean = false,
        val pageIndex: Int = 0,
        val isCurrentPage: Boolean = false,
        val relationshipOrigin: RelationshipOrigin = RelationshipOrigin.UNKNOWN,
        val lastMessageTime: String = "",
    )

    data class ChatPreparation(
        val root: AccessibilityNodeInfo,
        val ready: Boolean = true,
        val retryAfterMs: Long = 0L,
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
        val privacyProtected: Boolean = false,
        val exchangeSubmitted: Boolean = false
    )

    data class VoiceTranscriptionResult(
        val total: Int = 0,
        val transcribed: Int = 0
    ) {
        val hasAny: Boolean get() = transcribed > 0
        val isComplete: Boolean get() = total > 0 && transcribed == total
        val isPartial: Boolean get() = transcribed in 1 until total
    }

    enum class SendResult {
        SUCCESS,
        BANNED,
        TIMEOUT,
        NOT_VERIFIED,
        STOPPED
    }
}
