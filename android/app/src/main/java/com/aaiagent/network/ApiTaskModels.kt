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
