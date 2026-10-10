package com.aaiagent.engine

import com.google.gson.Gson

data class InFlightConversation(
    val platform: String,
    val contactId: String,
    val contactName: String,
    val pendingReplyParts: List<String> = emptyList(),
    val pendingReplyId: String = "",
    val pendingReplyIncomingFingerprint: String = "",
    val pendingReplyBatchFingerprint: String = "",
    val pendingReplyFullContent: String = "",
    val sentParts: Int = 0,
    val totalParts: Int = 0,
    val savedAtMs: Long = 0L
) {
    val key: String
        get() = "${platform.trim().lowercase()}:${contactId.trim()}"
}

object ConversationRecoveryCodec {
    private val gson = Gson()
    private const val MAX_RECORDS = 20

    fun encode(records: List<InFlightConversation>): String {
        return gson.toJson(normalize(records))
    }

    fun decode(value: String?): List<InFlightConversation> {
        if (value.isNullOrBlank()) return emptyList()
        return runCatching {
            gson.fromJson(value, Array<InFlightConversation>::class.java)?.toList().orEmpty()
        }.getOrDefault(emptyList()).let(::normalize)
    }

    fun upsert(
        records: List<InFlightConversation>,
        record: InFlightConversation
    ): List<InFlightConversation> {
        val normalized = normalize(records)
        val incoming = record.normalized()
        if (incoming.key == ":") return normalized
        return normalize(normalized.filterNot { it.key == incoming.key } + incoming)
            .takeLast(MAX_RECORDS)
    }

    fun remove(
        records: List<InFlightConversation>,
        platform: String,
        contactId: String
    ): List<InFlightConversation> {
        val key = InFlightConversation(
            platform = platform,
            contactId = contactId,
            contactName = ""
        ).key
        return normalize(records).filterNot { it.key == key }
    }

    fun recoverable(
        records: List<InFlightConversation>,
        platform: String,
        nowMs: Long,
        maxAgeMs: Long = DEFAULT_MAX_AGE_MS
    ): List<InFlightConversation> {
        return normalize(records).filter { record ->
            record.platform.equals(platform.trim(), ignoreCase = true) &&
                record.savedAtMs > 0L &&
                nowMs - record.savedAtMs in 0..maxAgeMs
        }
    }

    private fun normalize(records: List<InFlightConversation>): List<InFlightConversation> {
        val byKey = linkedMapOf<String, InFlightConversation>()
        for (record in records) {
            val normalized = record.normalized()
            if (normalized.key == ":") continue
            byKey.remove(normalized.key)
            byKey[normalized.key] = normalized
        }
        return byKey.values.toList().takeLast(MAX_RECORDS)
    }

    private fun InFlightConversation.normalized(): InFlightConversation {
        return copy(
            platform = platform.trim().lowercase(),
            contactId = contactId.trim(),
            contactName = contactName.trim(),
            pendingReplyParts = pendingReplyParts.map(String::trim).filter(String::isNotEmpty),
            pendingReplyId = pendingReplyId.trim(),
            pendingReplyIncomingFingerprint = pendingReplyIncomingFingerprint.trim(),
            pendingReplyBatchFingerprint = pendingReplyBatchFingerprint.trim(),
            pendingReplyFullContent = pendingReplyFullContent.trim(),
            sentParts = sentParts.coerceAtLeast(0),
            totalParts = totalParts.coerceAtLeast(0)
        )
    }

    private const val DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000L
}
