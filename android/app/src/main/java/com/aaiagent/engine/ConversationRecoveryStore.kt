package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

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

internal class ConversationRecoveryPersistence(
    private val readValue: suspend () -> String?,
    private val writeValue: suspend (String) -> Unit,
    private val mutex: Mutex = Mutex(),
) {
    constructor(repository: AppRepository) : this(
        readValue = { repository.getConfig(CONVERSATION_RECOVERY_KEY) },
        writeValue = { repository.setConfig(CONVERSATION_RECOVERY_KEY, it) },
    )

    suspend fun clear() {
        withContext(Dispatchers.IO) {
            mutex.withLock {
                writeValue(ConversationRecoveryCodec.encode(emptyList()))
            }
        }
    }

    suspend fun recoverable(
        platform: String,
        nowMs: Long = System.currentTimeMillis(),
    ): List<InFlightConversation> {
        val records = withContext(Dispatchers.IO) {
            mutex.withLock { ConversationRecoveryCodec.decode(readValue()) }
        }
        return ConversationRecoveryCodec.recoverable(
            records = records,
            platform = platform,
            nowMs = nowMs,
        )
    }

    suspend fun save(context: ConversationContext) {
        val record = synchronized(context) {
            InFlightConversation(
                platform = context.platform,
                contactId = context.contactId,
                contactName = context.contactName,
                pendingReplyParts = context.pendingReplyParts.toList(),
                pendingReplyId = context.pendingReplyId,
                pendingReplyIncomingFingerprint = context.pendingReplyIncomingFingerprint,
                pendingReplyBatchFingerprint = context.pendingReplyBatchFingerprint,
                pendingReplyFullContent = context.pendingReplyFullContent,
                sentParts = context.pendingReplySentParts,
                totalParts = context.pendingReplyTotalParts,
                savedAtMs = System.currentTimeMillis(),
            )
        }
        if (record.contactId.isBlank() || record.platform.isBlank()) return
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val records = ConversationRecoveryCodec.decode(readValue())
                writeValue(
                    ConversationRecoveryCodec.encode(
                        ConversationRecoveryCodec.upsert(records, record),
                    ),
                )
            }
        }
    }

    suspend fun remove(context: ConversationContext) {
        remove(context.platform, context.contactId)
    }

    suspend fun remove(platform: String, contactId: String) {
        if (platform.isBlank() || contactId.isBlank()) return
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val records = ConversationRecoveryCodec.decode(readValue())
                writeValue(
                    ConversationRecoveryCodec.encode(
                        ConversationRecoveryCodec.remove(records, platform, contactId),
                    ),
                )
            }
        }
    }

    suspend fun reconcile(context: ConversationContext) {
        val hasWork = synchronized(context) {
            context.pendingReplyParts.isNotEmpty() || context.pendingReplyId.isNotBlank()
        }
        if (hasWork) save(context) else remove(context)
    }

    private companion object {
        const val CONVERSATION_RECOVERY_KEY = "in_flight_conversations"
    }
}
