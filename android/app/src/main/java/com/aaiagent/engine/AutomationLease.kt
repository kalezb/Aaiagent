package com.aaiagent.engine

import java.util.UUID

/**
 * A single-owner lease for automation work.
 *
 * Starting a new hosting session revokes the previous session even if its
 * coroutine is still winding down. Every state-changing action checks this
 * lease before touching the UI.
 */
class AutomationLease(
    private val clock: () -> Long = System::currentTimeMillis,
    private val tokenFactory: () -> String = { UUID.randomUUID().toString() }
) {
    private var activeToken: String? = null
    private var expiresAtMs: Long = 0L

    @Synchronized
    fun acquire(ttlMs: Long = DEFAULT_TTL_MS): String {
        val token = tokenFactory()
        activeToken = token
        expiresAtMs = clock() + ttlMs
        return token
    }

    @Synchronized
    fun renew(token: String, ttlMs: Long = DEFAULT_TTL_MS): Boolean {
        if (!owns(token)) return false
        expiresAtMs = clock() + ttlMs
        return true
    }

    @Synchronized
    fun owns(token: String?): Boolean {
        return token != null && activeToken == token && clock() < expiresAtMs
    }

    @Synchronized
    fun isActive(): Boolean = owns(activeToken)

    @Synchronized
    fun revoke() {
        activeToken = null
        expiresAtMs = 0L
    }

    companion object {
        const val DEFAULT_TTL_MS = 30_000L
    }
}
