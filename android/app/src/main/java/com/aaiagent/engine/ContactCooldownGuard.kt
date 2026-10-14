package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class ContactCooldownGuard(
    private val currentPlatform: () -> String,
    private val readLeaveUntil: suspend (platform: String, contactKey: String) -> Long?,
    private val writeLeaveUntil: suspend (platform: String, contactKey: String, untilMs: Long) -> Unit,
    private val recordRecovery: (message: String) -> Unit = RuntimeJournal::recovery,
    private val now: () -> Long = System::currentTimeMillis,
) {
    constructor(
        repository: AppRepository,
        currentPlatform: () -> String,
    ) : this(
        currentPlatform = currentPlatform,
        readLeaveUntil = { platform, contactKey ->
            repository.getContactLeaveCooldownUntil(platform, contactKey)
        },
        writeLeaveUntil = { platform, contactKey, untilMs ->
            repository.setContactLeaveCooldownUntil(platform, contactKey, untilMs)
        },
    )

    private val replyCooldown = ConversationReplyCooldownPolicy()

    suspend fun isCoolingDown(contactName: String?, contactId: String?): Boolean {
        val keys = listOf(contactId, contactName)
            .mapNotNull { it?.trim() }
            .filter(String::isNotEmpty)
            .distinct()
        if (keys.isEmpty()) return false
        val nowMs = now()
        return withContext(Dispatchers.IO) {
            keys.any { key ->
                (readLeaveUntil(currentPlatform(), key) ?: 0L) > nowMs
            }
        }
    }

    suspend fun persistLeave(
        context: ConversationContext,
        durationMs: Long,
        reason: String,
    ) {
        val untilMs = now() + durationMs.coerceAtLeast(MIN_LEAVE_COOLDOWN_MS)
        withContext(Dispatchers.IO) {
            writeLeaveUntil(currentPlatform(), context.contactId, untilMs)
        }
        recordRecovery(
            "离开冷却已记录 contact=${context.contactName.ifBlank { context.contactId }} reason=$reason"
        )
    }

    fun block(contactName: String?, retryAfterMs: Long) {
        replyCooldown.block(contactName, retryAfterMs, now())
    }

    fun isBlocked(contactName: String?, contactId: String?): Boolean {
        return replyCooldown.isBlocked(contactName, now()) ||
            replyCooldown.isBlocked(contactId, now())
    }

    private companion object {
        const val MIN_LEAVE_COOLDOWN_MS = 60_000L
    }
}
