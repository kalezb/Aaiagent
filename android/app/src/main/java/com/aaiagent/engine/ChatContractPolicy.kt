package com.aaiagent.engine

import com.aaiagent.network.ChatResponse
import com.aaiagent.network.ChatTurnSnapshot

object ChatContractPolicy {
    const val VERSION = 2

    data class Validation(
        val ok: Boolean,
        val reason: String = "",
    )

    fun validate(
        snapshot: ChatTurnSnapshot,
        response: ChatResponse,
    ): Validation {
        val action = response.action.orEmpty().trim()
        if (action != "send" && action != "send_media") return Validation(true)
        val version = response.schemaVersion
            ?: return Validation(false, "response_contract_missing")
        if (version != VERSION) {
            return Validation(false, "unsupported_chat_contract_version")
        }
        if (response.turnId.orEmpty().trim() != snapshot.turnId.trim()) {
            return Validation(false, "response_turn_id_mismatch")
        }
        if (response.inputDigest.orEmpty().trim() != snapshot.messageDigest.trim()) {
            return Validation(false, "response_input_digest_mismatch")
        }
        val parts = finalReplyParts(response)
        val reply = response.reply.orEmpty().trim()
        if (action == "send" && parts.isEmpty()) {
            return Validation(false, "response_reply_parts_missing")
        }
        if (reply.isNotEmpty() && parts.isEmpty()) {
            return Validation(false, "response_reply_parts_missing")
        }
        if (parts.isNotEmpty() && response.reply.isNullOrBlank()) {
            return Validation(false, "response_reply_missing")
        }
        if (parts.isNotEmpty() && reply != parts.joinToString("|||")) {
            return Validation(false, "response_reply_parts_mismatch")
        }
        return Validation(true)
    }

    fun finalReplyParts(response: ChatResponse): List<String> {
        return response.replyParts
            .orEmpty()
            .map(String::trim)
            .filter(String::isNotBlank)
    }

    fun finalReplyText(response: ChatResponse): String {
        val parts = finalReplyParts(response)
        return if (parts.isNotEmpty()) parts.joinToString("|||") else response.reply.orEmpty().trim()
    }
}
