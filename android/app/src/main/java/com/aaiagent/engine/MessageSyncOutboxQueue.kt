package com.aaiagent.engine

import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

internal class MessageSyncOutboxQueue(
    private val scope: CoroutineScope,
    private val pendingMessages: suspend (Long, Int) -> List<MessageSyncOutboxEntity>,
    private val deleteMessages: suspend (List<String>) -> Unit,
    private val markMessagesFailed: suspend (List<String>, Long) -> Unit,
    private val syncMessages: suspend (List<MessageSyncOutboxEntity>) -> Boolean,
) {
    constructor(repository: AppRepository, scope: CoroutineScope) : this(
        scope = scope,
        pendingMessages = repository::pendingSyncMessages,
        deleteMessages = repository::deleteSyncMessages,
        markMessagesFailed = repository::markSyncMessagesFailed,
        syncMessages = { group ->
            val first = group.first()
            ApiService(repository.getApiBaseUrl()).syncMessages(
                token = first.token,
                platform = first.platform,
                contactId = first.contactId,
                contactName = first.contactName,
                messages = group.map {
                    mapOf<String, Any>(
                        "message_key" to it.id,
                        "role" to it.role,
                        "content" to it.content,
                        "source" to it.source,
                        "created_at" to it.createdAt,
                        "time_kind" to it.timeKind,
                        "transcript" to it.transcript,
                        "voice_seconds" to it.voiceSeconds,
                    )
                },
            )
        },
    )

    private val mutex = Mutex()
    private var flushJob: Job? = null
    private var lastFlushAt: Long = 0L

    fun schedule(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!SyncOutboxPolicy.shouldAttempt(lastFlushAt, now, force, SYNC_FLUSH_INTERVAL_MS)) return
        if (flushJob?.isActive == true) return
        lastFlushAt = now
        flushJob = scope.launch(Dispatchers.IO) {
            flushSerially()
        }
    }

    suspend fun awaitFlush() {
        withContext(Dispatchers.IO) {
            val completed = withTimeoutOrNull(SYNC_BEFORE_CHAT_WAIT_MS) {
                flushSerially()
                true
            } ?: false
            if (!completed) {
                runCatching {
                    android.util.Log.w(
                        "AIA",
                        "sync outbox wait timed out before chat wait_ms=$SYNC_BEFORE_CHAT_WAIT_MS",
                    )
                }
            }
        }
    }

    internal suspend fun flushSerially() {
        mutex.withLock {
            flushLocked()
        }
    }

    private suspend fun flushLocked() {
        val startedAt = System.currentTimeMillis()
        try {
            val pending = pendingMessages(System.currentTimeMillis(), 100)
            if (pending.isEmpty()) return
            runCatching {
                android.util.Log.d("AIA", "sync outbox flush started count=${pending.size}")
            }
            pending.groupBy { Triple(it.token, it.platform, it.contactId) }
                .values
                .forEach { group ->
                    val success = runCatching {
                        syncMessages(group)
                    }.getOrDefault(false)
                    val ids = group.map { it.id }
                    if (success) {
                        deleteMessages(ids)
                    } else {
                        val attempts = group.maxOf { it.attempts } + 1
                        val backoff = SyncOutboxPolicy.retryDelayMs(attempts)
                        markMessagesFailed(ids, System.currentTimeMillis() + backoff)
                    }
                }
            runCatching {
                android.util.Log.d(
                    "AIA",
                    "sync outbox flush complete elapsed=${System.currentTimeMillis() - startedAt}",
                )
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            runCatching {
                android.util.Log.w(
                    "AIA",
                    "sync outbox flush failed elapsed=${System.currentTimeMillis() - startedAt}: ${error.message}",
                    error,
                )
            }
        }
    }

    private companion object {
        const val SYNC_FLUSH_INTERVAL_MS = 45_000L
        const val SYNC_BEFORE_CHAT_WAIT_MS = 8_000L
    }
}
