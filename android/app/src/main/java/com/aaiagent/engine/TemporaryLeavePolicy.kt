package com.aaiagent.engine

object TemporaryLeavePolicy {
    private const val SEMANTIC_EXIT_ERROR = "social_exit"
    private const val DEFAULT_SEMANTIC_EXIT_COOLDOWN_MS = 15 * 60_000L

    fun semanticExitCooldownMs(error: String?, cooldownMs: Long?): Long? {
        if (error != SEMANTIC_EXIT_ERROR) return null
        return cooldownMs?.takeIf { it > 0L } ?: DEFAULT_SEMANTIC_EXIT_COOLDOWN_MS
    }
}
