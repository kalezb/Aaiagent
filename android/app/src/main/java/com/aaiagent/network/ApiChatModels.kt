package com.aaiagent.network

import com.google.gson.annotations.SerializedName

data class ChatRequest(
    val token: String,
    val platform: String,
    @SerializedName("hosting_mode") val hostingMode: String,
    @SerializedName("request_id") val requestId: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, Any>>,
    val snapshot: ChatTurnSnapshot? = null,
    @SerializedName("conversation_timeline") val conversationTimeline: String? = null,
    @SerializedName("conversation_stage") val conversationStage: String = "unknown",
    @SerializedName("relationship_origin") val relationshipOrigin: String = "unknown",
    /** 本机当前平台账号昵称，用户手填；空串表示没填（见 SelfNicknamePolicy）。 */
    @SerializedName("self_nickname") val selfNickname: String = "",
    val location: Map<String, Map<String, String>>? = null
)

data class ChatTurnSnapshot(
    @SerializedName("turn_id") val turnId: String,
    @SerializedName("message_count") val messageCount: Int,
    @SerializedName("last_message_at") val lastMessageAt: Long,
    @SerializedName("capture_complete") val captureComplete: Boolean,
)

data class ChatResponse(
    val action: String?,
    val reply: String?,
    val media: ChatMedia?,
    @SerializedName("reply_id") val replyId: String?,
    val error: String?,
    val code: String? = null,
    @SerializedName("request_id") val requestId: String? = null,
    @SerializedName("cooldown_ms") val cooldownMs: Long? = null,
    @SerializedName("self_leave_ms") val selfLeaveMs: Long? = null,
    val reason: String? = null,
    val timing: ChatTiming? = null,
    @SerializedName("persona_id") val personaId: String? = null,
    @SerializedName("persona_version") val personaVersion: Int? = null,
    @SerializedName("model_line") val modelLine: String? = null,
    @SerializedName("model_name") val modelName: String? = null,
    @SerializedName("reply_audit") val replyAudit: ReplyAudit? = null
)

data class ReplyAudit(
    val source: String? = null,
    val reason: String? = null,
    val overrides: List<ReplyAuditOverride> = emptyList()
)

data class ReplyAuditOverride(
    val rule: String? = null,
    val reason: String? = null,
    val before: String? = null,
    val after: String? = null
)

data class ChatTiming(
    @SerializedName("persona_ms") val personaMs: Long? = null,
    @SerializedName("context_ms") val contextMs: Long? = null,
    @SerializedName("llm_ms") val llmMs: Long? = null,
    @SerializedName("main_llm_ms") val mainLlmMs: Long? = null,
    @SerializedName("repair_ms") val repairMs: Long? = null,
    @SerializedName("total_ms") val totalMs: Long? = null,
    @SerializedName("repair_attempted") val repairAttempted: Boolean? = null,
    @SerializedName("repair_timeout") val repairTimeout: Boolean? = null,
    @SerializedName("llm_budget_ms") val llmBudgetMs: Long? = null
)

data class NetworkTiming(
    val dnsMs: Long? = null,
    val connectMs: Long? = null,
    val tlsMs: Long? = null,
    val requestMs: Long? = null,
    val ttfbMs: Long? = null,
    val responseBodyMs: Long? = null,
    val totalMs: Long? = null
)

data class ChatCallResult(
    val response: ChatResponse,
    val networkTiming: NetworkTiming
)

data class ExchangeMediaRequest(
    val token: String,
    val platform: String,
    @SerializedName("hosting_mode") val hostingMode: String,
    @SerializedName("request_id") val requestId: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String
)

data class ChatMedia(
    val type: String?,
    @SerializedName("asset_id") val assetId: String?,
    @SerializedName("group_id") val groupId: String?,
    @SerializedName("download_url") val downloadUrl: String?,
    @SerializedName("content_type") val contentType: String?,
    @SerializedName("file_name") val fileName: String?
)
