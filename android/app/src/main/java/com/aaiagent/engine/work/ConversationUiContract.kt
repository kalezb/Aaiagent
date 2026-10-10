package com.aaiagent.engine.work

import com.aaiagent.engine.observability.AutomationPageKind

data class ConversationUiSnapshot(
    val platform: String,
    val pageKind: AutomationPageKind,
    val reason: String,
    val capturedAtMs: Long,
    val contactStableId: String = "",
    val contactName: String = "",
    val unreadCount: Int = 0,
    val windowLayer: Int = 0,
    val nodeCount: Int = 0,
)

data class ConversationOpenResult(
    val opened: Boolean,
    val verifiedIdentity: ConversationIdentity? = null,
    val reason: String = "",
    val origin: String = "",
)

data class ConversationReadResult(
    val read: Boolean,
    val latestIncomingFingerprint: String = "",
    val messages: List<ConversationUiMessage> = emptyList(),
    val reason: String = "",
)

data class ConversationUiMessage(
    val sender: String,
    val type: String,
    val content: String,
    val identityKey: String,
    val timestampText: String,
)

data class ConversationSendResult(
    val sent: Boolean,
    val verified: Boolean,
    val reason: String = "",
)

/**
 * 所有平台只实现这一份“页面翻译接口”。
 *
 * 核心任务状态机只认这些结果，不直接认识任何平台控件。
 */
interface ConversationUiContract {
    val platform: String

    fun snapshot(): ConversationUiSnapshot

    suspend fun scanUnread(maxEntries: Int): List<ConversationIdentity>

    /**
     * 影子模式专用的只读扫描：只读取当前可见的未读，不滚动页面。
     */
    suspend fun scanVisibleUnread(maxEntries: Int): List<ConversationIdentity> =
        scanUnread(maxEntries)

    suspend fun openConversation(
        identity: ConversationIdentity,
    ): ConversationOpenResult

    fun verifyConversation(
        expected: ConversationIdentity,
    ): ConversationOpenResult

    fun readLatestMessages(): ConversationReadResult

    suspend fun sendText(
        text: String,
        operationId: String,
    ): ConversationSendResult

    suspend fun returnToMessageList(): Boolean

    fun isRiskOverlay(observation: ConversationUiSnapshot): Boolean = false
}
