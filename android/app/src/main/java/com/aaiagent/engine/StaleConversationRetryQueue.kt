package com.aaiagent.engine

internal data class ConversationRetry(
    val platform: String,
    val contactId: String,
    val contactName: String,
    val attempts: Int,
    val dueAtMs: Long,
)

internal class StaleConversationRetryQueue(
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val items = linkedMapOf<String, ConversationRetry>()

    fun clear() {
        synchronized(items) {
            items.clear()
        }
    }

    fun restore(
        platform: String,
        contactId: String,
        contactName: String,
        dueAtMs: Long,
    ) {
        synchronized(items) {
            items[key(platform, contactId)] = ConversationRetry(
                platform = platform,
                contactId = contactId,
                contactName = contactName,
                attempts = 0,
                dueAtMs = dueAtMs,
            )
        }
    }

    fun takeDue(platform: String, nowMs: Long): ConversationRetry? {
        return synchronized(items) {
            val entry = items.entries.firstOrNull {
                it.value.platform == platform && it.value.dueAtMs <= nowMs
            } ?: return@synchronized null
            items[entry.key] = entry.value.copy(dueAtMs = Long.MAX_VALUE)
            entry.value
        }
    }

    fun enqueue(
        platform: String,
        contactId: String,
        contactName: String,
        delayMs: Long,
        maxAttempts: Int,
    ): Int {
        val itemKey = key(platform, contactId)
        val nextAttempts = synchronized(items) {
            val attempts = (items[itemKey]?.attempts ?: 0) + 1
            if (attempts <= maxAttempts) {
                items[itemKey] = ConversationRetry(
                    platform = platform,
                    contactId = contactId,
                    contactName = contactName,
                    attempts = attempts,
                    dueAtMs = now() + delayMs.coerceAtLeast(0L),
                )
            } else {
                items.remove(itemKey)
            }
            attempts
        }
        runCatching {
            android.util.Log.d(
                "AIA",
                "stale reply queued for immediate retry " +
                    "contact=$contactName attempt=$nextAttempts",
            )
        }
        return nextAttempts
    }

    fun scheduleNext(retry: ConversationRetry, delayMs: Long, maxAttempts: Int) {
        val next = retry.copy(
            attempts = retry.attempts + 1,
            dueAtMs = now() + delayMs,
        )
        val itemKey = key(retry.platform, retry.contactId)
        synchronized(items) {
            if (next.attempts <= maxAttempts) {
                items[itemKey] = next
            } else {
                items.remove(itemKey)
            }
        }
    }

    fun reschedule(retry: ConversationRetry, delayMs: Long) {
        synchronized(items) {
            items[key(retry.platform, retry.contactId)] = retry.copy(
                dueAtMs = now() + delayMs,
            )
        }
    }

    fun remove(retry: ConversationRetry) {
        synchronized(items) {
            items.remove(key(retry.platform, retry.contactId))
        }
    }

    fun clearInFlight(retry: ConversationRetry) {
        val itemKey = key(retry.platform, retry.contactId)
        synchronized(items) {
            if (items[itemKey]?.dueAtMs == Long.MAX_VALUE) {
                items.remove(itemKey)
            }
        }
    }

    internal fun pendingCount(): Int {
        return synchronized(items) {
            items.size
        }
    }

    private fun key(platform: String, contactId: String): String = "$platform:$contactId"
}
