package com.aaiagent.engine

import com.aaiagent.network.ChatMedia

internal data class ReplySuggestion(
    val content: String,
    val replyParts: List<String> = emptyList(),
    val replyId: String?,
    val media: ChatMedia? = null,
    val deliveryFingerprint: String? = null,
    val incomingBatchFingerprint: String? = null,
    val selfLeaveCooldownMs: Long? = null,
    val mediaExpected: Boolean = false,
)
