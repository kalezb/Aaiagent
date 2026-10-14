package com.aaiagent.engine

import com.aaiagent.data.db.entity.PendingReplyConfirmationEntity
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class ReplyConfirmationQueue(
    private val scope: CoroutineScope,
    private val activeToken: suspend () -> String?,
    private val enqueueConfirmation: suspend (PendingReplyConfirmationEntity) -> Unit,
    private val pendingConfirmations: suspend (Long, Int) -> List<PendingReplyConfirmationEntity>,
    private val deleteConfirmation: suspend (String) -> Unit,
    private val markConfirmationFailed: suspend (String, Long) -> Unit,
    private val confirmWithServer: suspend (PendingReplyConfirmationEntity) -> Boolean,
) {
    constructor(repository: AppRepository, scope: CoroutineScope) : this(
        scope = scope,
        activeToken = { repository.getActiveToken()?.token?.trim() },
        enqueueConfirmation = repository::enqueueReplyConfirmation,
        pendingConfirmations = { now, limit -> repository.pendingReplyConfirmations(now, limit) },
        deleteConfirmation = repository::deleteReplyConfirmation,
        markConfirmationFailed = repository::markReplyConfirmationFailed,
        confirmWithServer = { item ->
            ApiService(repository.getApiBaseUrl()).confirmChatReply(
                item.token,
                item.replyId,
                item.sentContent,
            )
        },
    )

    private var flushJob: Job? = null
    private var lastFlushAt: Long = 0L

    suspend fun confirmPendingReply(context: ConversationContext): Boolean {
        val replyId = synchronized(context) { context.pendingReplyId }
        if (replyId.isBlank()) return true
        val token = withContext(Dispatchers.IO) { activeToken() }.orEmpty()
        if (token.isBlank()) return false
        return enqueuePendingReply(context, replyId, token)
    }

    suspend fun queueSentReply(replyId: String, sentContent: String): Boolean {
        if (replyId.isBlank()) return true
        val token = withContext(Dispatchers.IO) { activeToken() }.orEmpty()
        if (token.isBlank()) return false
        withContext(Dispatchers.IO) {
            enqueueConfirmation(
                PendingReplyConfirmationEntity(
                    replyId = replyId,
                    token = token,
                    sentContent = sentContent,
                ),
            )
        }
        scheduleFlush(force = true)
        runCatching { android.util.Log.d("AIA", "chat confirm queued replyId=$replyId") }
        return true
    }

    private suspend fun enqueuePendingReply(
        context: ConversationContext,
        replyId: String,
        token: String,
    ): Boolean {
        val sentContent = synchronized(context) {
            context.pendingReplyFullContent.ifBlank {
                context.pendingReplyParts.joinToString("|||")
            }
        }
        withContext(Dispatchers.IO) {
            enqueueConfirmation(
                PendingReplyConfirmationEntity(
                    replyId = replyId,
                    token = token,
                    sentContent = sentContent,
                ),
            )
        }
        synchronized(context) {
            if (context.pendingReplyId == replyId) {
                context.pendingReplyId = ""
                context.pendingReplyFullContent = ""
            }
        }
        scheduleFlush(force = true)
        runCatching { android.util.Log.d("AIA", "chat confirm queued replyId=$replyId") }
        return true
    }

    fun scheduleFlush(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastFlushAt < CONFIRMATION_FLUSH_INTERVAL_MS) return
        if (flushJob?.isActive == true) return
        lastFlushAt = now
        flushJob = scope.launch(Dispatchers.IO) {
            val pending = pendingConfirmations(now, 50)
            if (pending.isEmpty()) return@launch
            for (item in pending) {
                val confirmed = runCatching {
                    confirmWithServer(item)
                }.getOrDefault(false)
                if (confirmed) {
                    deleteConfirmation(item.replyId)
                } else {
                    val attempts = item.attempts + 1
                    markConfirmationFailed(
                        item.replyId,
                        System.currentTimeMillis() + SyncOutboxPolicy.retryDelayMs(attempts),
                    )
                }
            }
        }
    }

    private companion object {
        const val CONFIRMATION_FLUSH_INTERVAL_MS = 5_000L
    }
}
