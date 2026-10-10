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
    enum class Status {
        ACTIVE,
        EXPIRED,
        REVOKED,
        REPLACED,
        UNKNOWN
    }

    private var activeToken: String? = null
    private var expiresAtMs: Long = 0L
    private var revokedToken: String? = null
    private var replacedToken: String? = null

    @Synchronized
    fun acquire(ttlMs: Long = DEFAULT_TTL_MS): String {
        replacedToken = activeToken?.takeIf { it != revokedToken }
        revokedToken = null
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
    fun status(token: String?): Status {
        if (token == null) return Status.UNKNOWN
        if (token == activeToken) {
            return if (clock() < expiresAtMs) Status.ACTIVE else Status.EXPIRED
        }
        if (token == revokedToken) return Status.REVOKED
        if (token == replacedToken) return Status.REPLACED
        return Status.UNKNOWN
    }

    @Synchronized
    fun isActive(): Boolean = owns(activeToken)

    @Synchronized
    fun revoke() {
        revokedToken = activeToken
        replacedToken = null
        activeToken = null
        expiresAtMs = 0L
    }

    companion object {
        const val DEFAULT_TTL_MS = 30_000L
    }
}
