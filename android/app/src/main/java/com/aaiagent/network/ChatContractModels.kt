package com.aaiagent.network

import com.google.gson.annotations.SerializedName

data class ChatMessagePayload(
    val role: String,
    val content: String,
    val type: String,
    val kind: String,
    val transcript: String,
    @SerializedName("transcript_status") val transcriptStatus: String,
    val sequence: Int,
    @SerializedName("client_message_id") val clientMessageId: String,
    val timestamp: String,
    @SerializedName("created_at") val createdAt: Long,
    @SerializedName("timestamp_trusted") val timestampTrusted: Boolean,
)

data class ChatTurnSnapshot(
    @SerializedName("turn_id") val turnId: String,
    @SerializedName("message_count") val messageCount: Int,
    @SerializedName("last_message_at") val lastMessageAt: Long,
    @SerializedName("capture_complete") val captureComplete: Boolean,
    @SerializedName("contact_verified") val contactVerified: Boolean,
    @SerializedName("message_digest") val messageDigest: String,
)
