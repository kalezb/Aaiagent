package com.aaiagent.network

import com.google.gson.annotations.SerializedName

data class ConfirmChatRequest(
    @SerializedName("reply_id") val replyId: String,
    @SerializedName("sent_content") val sentContent: String
)

data class ConfirmChatResponse(
    val success: Boolean?,
    val status: String?,
    val error: String?
)

data class VisionResponse(
    val success: Boolean,
    val description: String?,
    val error: String?
)

data class ReplyTask(
    val type: String,
    @SerializedName("task_id") val taskId: String?,
    @SerializedName("group_id") val groupId: String?,
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val content: String?
)

data class ReplyTaskResponse(val task: ReplyTask?)

data class VisualGroundingPoint(
    val x: Int = 0,
    val y: Int = 0
)

data class VisualGroundingNormalizedPoint(
    val x: Double = 0.0,
    val y: Double = 0.0
)

data class VisualGroundingResponse(
    val success: Boolean = false,
    @SerializedName("has_popup") val hasPopup: Boolean = false,
    @SerializedName("popup_kind") val popupKind: String = "none",
    val action: String = "none",
    @SerializedName("target_point") val targetPoint: VisualGroundingPoint? = null,
    @SerializedName("normalized_point") val normalizedPoint: VisualGroundingNormalizedPoint? = null,
    val confidence: Double = 0.0,
    val reason: String = "",
    val error: String? = null
)
