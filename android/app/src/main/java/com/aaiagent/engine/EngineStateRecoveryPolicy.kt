package com.aaiagent.engine

/**
 * Keeps a transient state from becoming a permanent hosting-loop lock.
 *
 * The timeout is intentionally per-state: an LLM request has a much larger
 * legitimate budget than a scan or a local send operation.
 */
object EngineStateRecoveryPolicy {
    const val SCANNING_TIMEOUT_MS = 30_000L
    const val READING_TIMEOUT_MS = 45_000L
    const val LLM_TIMEOUT_MS = 180_000L
    const val SENDING_TIMEOUT_MS = 60_000L
    // A conversation-level failure is handled in place (ErrorRecovery already
    // navigates back to the list), so the state only needs a short backstop.
    // 120s used to freeze the whole hosting loop for two minutes per error.
    const val ERROR_TIMEOUT_MS = 10_000L

    fun timeoutMs(state: EngineState): Long? {
        return when (state) {
            is EngineState.ScanningConversations -> SCANNING_TIMEOUT_MS
            is EngineState.ReadingMessages -> READING_TIMEOUT_MS
            is EngineState.WaitingLLM -> LLM_TIMEOUT_MS
            is EngineState.AboutToSend,
            is EngineState.Sending -> SENDING_TIMEOUT_MS
            is EngineState.Error -> ERROR_TIMEOUT_MS
            is EngineState.Idle,
            is EngineState.Paused -> null
        }
    }

    fun shouldRecover(
        state: EngineState,
        enteredAtMs: Long,
        nowMs: Long
    ): Boolean {
        val timeout = timeoutMs(state) ?: return false
        if (enteredAtMs <= 0L || nowMs < enteredAtMs) return false
        return nowMs - enteredAtMs >= timeout
    }
}
