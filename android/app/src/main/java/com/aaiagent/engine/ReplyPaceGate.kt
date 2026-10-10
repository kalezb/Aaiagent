package com.aaiagent.engine

import kotlinx.coroutines.delay

/**
 * Borrows xiniuzi reply-pace: minimum gap between two sends to the same contact.
 * Cloud value comes from /api/config -> reply_pace_sec (default 8s).
 */
object ReplyPaceGate {
    @Volatile var paceSec: Int = 0
    private val lastSentAt = mutableMapOf<String, Long>()

    fun key(platform: String, contactId: String): String = "$platform\u0000$contactId"

    suspend fun waitForTurn(platform: String, contactId: String) {
        val paceMs = paceSec.coerceIn(0, 300) * 1000L
        if (paceMs <= 0) return
        val k = key(platform, contactId)
        val now = System.currentTimeMillis()
        val last = synchronized(lastSentAt) { lastSentAt[k] ?: 0L }
        val waitMs = paceMs - (now - last)
        if (waitMs > 0) delay(waitMs)
    }

    fun markSent(platform: String, contactId: String) {
        synchronized(lastSentAt) { lastSentAt[key(platform, contactId)] = System.currentTimeMillis() }
    }
}
