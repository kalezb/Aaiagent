package com.aaiagent

import com.aaiagent.engine.EngineState
import com.aaiagent.engine.EngineStateRecoveryPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineStateRecoveryPolicyTest {
    @Test
    fun `idle and paused states are never recovered as stale work`() {
        assertFalse(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.Idle,
                enteredAtMs = 0L,
                nowMs = 10_000_000L,
            )
        )
        assertFalse(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.Paused,
                enteredAtMs = 0L,
                nowMs = 10_000_000L,
            )
        )
    }

    @Test
    fun `scanning state is recovered only after its bounded timeout`() {
        assertFalse(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.ScanningConversations,
                enteredAtMs = 1_000L,
                nowMs = 1_000L + EngineStateRecoveryPolicy.SCANNING_TIMEOUT_MS - 1L,
            )
        )
        assertTrue(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.ScanningConversations,
                enteredAtMs = 1_000L,
                nowMs = 1_000L + EngineStateRecoveryPolicy.SCANNING_TIMEOUT_MS,
            )
        )
    }

    @Test
    fun `error state recovers within seconds instead of blocking the loop for minutes`() {
        // Regression: ERROR_TIMEOUT_MS was 120s, so a single conversation-level
        // exception froze every scan for two minutes.
        assertTrue(EngineStateRecoveryPolicy.ERROR_TIMEOUT_MS <= 15_000L)
        assertTrue(EngineStateRecoveryPolicy.shouldRecover(
            state = EngineState.Error,
            enteredAtMs = 1_000L,
            nowMs = 1_000L + EngineStateRecoveryPolicy.ERROR_TIMEOUT_MS,
        ))
    }

    @Test
    fun `llm state gets a larger timeout than local sending`() {
        assertFalse(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.WaitingLLM,
                enteredAtMs = 1_000L,
                nowMs = 1_000L + EngineStateRecoveryPolicy.SENDING_TIMEOUT_MS,
            )
        )
        assertTrue(
            EngineStateRecoveryPolicy.shouldRecover(
                state = EngineState.WaitingLLM,
                enteredAtMs = 1_000L,
                nowMs = 1_000L + EngineStateRecoveryPolicy.LLM_TIMEOUT_MS,
            )
        )
    }
}
