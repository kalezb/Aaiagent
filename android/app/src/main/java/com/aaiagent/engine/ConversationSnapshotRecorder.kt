package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.SoulMessageIdentity
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.data.repository.AppRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal data class ConversationSnapshotResult(
    val messages: List<ChatMessage>,
    val ambiguous: Boolean = false,
)

private data class SnapshotPersistenceResult(
    val snapshot: ConversationSnapshotResult,
    val inserted: Int = 0,
)

internal class ConversationSnapshotRecorder(
    private val repository: AppRepository,
    private val messageSyncOutbox: MessageSyncOutboxQueue,
    private val currentPlatform: () -> String,
) {
    suspend fun record(
        context: ConversationContext,
        messages: List<ChatMessage>,
        manualCapture: Boolean = false,
        latestListPreview: String = "",
        latestListTime: String = "",
    ): ConversationSnapshotResult {
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim()
        }.orEmpty()
        if (token.isEmpty() || messages.isEmpty()) {
            return ConversationSnapshotResult(messages)
        }

        val automatedReplies = synchronized(context) { context.aiSentContents.toSet() }
        val platform = context.platform.ifBlank(currentPlatform)
        val stateId = listOf(token, platform, context.contactId).joinToString("\u0000")
        val reconciliation = withContext(Dispatchers.IO) {
            repository.cleanOldCache()
            val previousState = repository.getConversationSyncState(stateId)
            val previousSnapshot = SyncSnapshotCodec.decode(previousState?.snapshotJson)
            val derivedSeconds = SyncTimePolicy.deriveSeconds(
                millisList = messages.map {
                    if (it.timestampTrusted) it.timestampMillis else null
                },
                nowMs = System.currentTimeMillis(),
            )
            val snapshotMessageIndexes = messages.indices.filter { index ->
                messages[index].content.trim().isNotEmpty()
            }
            val currentSnapshot = snapshotMessageIndexes.map { index ->
                val message = messages[index]
                val role = if (message.sender == "self") "assistant" else "user"
                val content = message.content.trim()
                SyncSnapshotItem(
                    role = role,
                    content = content,
                    createdAt = derivedSeconds.getOrNull(index),
                    contentKey = message.identityKey.trim().takeIf(String::isNotEmpty)
                        ?: listOf(
                            role,
                            message.type,
                            content.replace(Regex("\\s+"), " "),
                        ).joinToString("\u001f"),
                    explicitTime = SoulMessageIdentity.hasExplicitTime(
                        message.timestampText,
                        message.timestampMillis,
                        message.timestampTrusted,
                    ),
                    transcript = message.transcript.trim().takeIf(String::isNotEmpty),
                    voiceSeconds = message.voiceSeconds.takeIf { it > 0 },
                )
            }
            val hasEstablishedBaseline = previousState?.snapshotJson?.isNotBlank() == true
            var ledger = ConversationMessageLedger.reconcile(
                previous = previousSnapshot,
                current = currentSnapshot,
                hasEstablishedBaseline = hasEstablishedBaseline,
                nextOrdinal = previousState?.nextSequence ?: 0L,
            )
            if (ledger.ambiguous) {
                val canAppend = SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
                    previous = previousSnapshot,
                    messages = messages,
                    listPreview = latestListPreview,
                    listTimeText = latestListTime,
                )
                if (canAppend) {
                    ledger = ConversationMessageLedger.appendVisibleLatest(
                        previous = previousSnapshot,
                        current = currentSnapshot,
                        nextOrdinal = previousState?.nextSequence ?: 0L,
                    )
                } else {
                    return@withContext SnapshotPersistenceResult(
                        ConversationSnapshotResult(messages, ambiguous = true)
                    )
                }
            }

            val transcriptUpdates = ledger.items.indices.filter { index ->
                val currentItem = ledger.items[index]
                val currentKey = currentItem.stableKey.orEmpty().trim()
                currentKey.isNotEmpty() &&
                    !currentItem.transcript.isNullOrBlank() &&
                    previousSnapshot.any { old ->
                        old.stableKey.orEmpty().trim() == currentKey &&
                            old.transcript.isNullOrBlank()
                    }
            }
            val needsLedgerMigration = previousSnapshot.isNotEmpty() &&
                previousSnapshot.all { it.contentKey.isNullOrBlank() }
            val syncIndexes = if (needsLedgerMigration) {
                ledger.items.indices.toList()
            } else {
                (ledger.newIndexes + transcriptUpdates).distinct().sorted()
            }

            var sequence = ledger.nextOrdinal
            val outbox = mutableListOf<MessageSyncOutboxEntity>()
            for (index in syncIndexes) {
                val item = ledger.items[index]
                val sequenceForMessage = item.ledgerOrdinal ?: run {
                    sequence += 1L
                    sequence
                }
                if (item.role == "assistant" && item.content in automatedReplies) {
                    if (manualCapture) {
                        android.util.Log.d("AIA", "manual sync skipped automated reply")
                    }
                    continue
                }
                val id = SyncMessageKey.build(
                    platform = platform,
                    contactId = context.contactId,
                    role = item.role,
                    content = item.content,
                    sequence = sequenceForMessage,
                    createdAt = item.createdAt,
                    stableKey = item.stableKey,
                )
                outbox += MessageSyncOutboxEntity(
                    id = id,
                    token = token,
                    platform = platform,
                    contactId = context.contactId,
                    contactName = context.contactName,
                    role = item.role,
                    content = item.content,
                    source = if (item.role == "assistant") "human_phone" else "sync",
                    createdAt = item.createdAt ?: (System.currentTimeMillis() / 1000),
                    timeKind = if (item.explicitTime == true) "ui_explicit" else "first_observed",
                    transcript = item.transcript.orEmpty(),
                    voiceSeconds = item.voiceSeconds ?: 0,
                )
            }
            val state = ConversationSyncStateEntity(
                id = stateId,
                platform = platform,
                contactId = context.contactId,
                snapshotJson = SyncSnapshotCodec.encode(ledger.items),
                nextSequence = sequence,
            )
            val inserted = repository.persistSyncSnapshot(state, outbox)
            val ledgerKeys = MutableList(messages.size) { "" }
            val currentLedgerItems = ledger.items.takeLast(currentSnapshot.size)
            snapshotMessageIndexes.forEachIndexed { snapshotIndex, messageIndex ->
                ledgerKeys[messageIndex] = currentLedgerItems.getOrNull(snapshotIndex)
                    ?.stableKey
                    .orEmpty()
            }
            SnapshotPersistenceResult(
                snapshot = ConversationSnapshotResult(
                    messages = messages.mapIndexed { index, message ->
                        message.copy(ledgerKey = ledgerKeys[index])
                    }
                ),
                inserted = inserted,
            )
        }
        if (reconciliation.snapshot.ambiguous) return reconciliation.snapshot
        if (reconciliation.inserted > 0) {
            messageSyncOutbox.schedule(force = true)
        }
        return reconciliation.snapshot
    }
}
