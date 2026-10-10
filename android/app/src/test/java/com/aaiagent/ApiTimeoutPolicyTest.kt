package com.aaiagent

import com.aaiagent.network.ApiTimeoutPolicy
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiTimeoutPolicyTest {
    @Test
    fun `background maintenance requests use a short bounded call timeout`() {
        assertTrue(ApiTimeoutPolicy.SHORT_CONNECT_TIMEOUT_SECONDS <= 10L)
        assertTrue(ApiTimeoutPolicy.SHORT_READ_TIMEOUT_SECONDS <= 15L)
        assertTrue(ApiTimeoutPolicy.SHORT_CALL_TIMEOUT_SECONDS <= 20L)
    }

    @Test
    fun `model requests stay within the interactive timeout budget`() {
        assertTrue(ApiTimeoutPolicy.MODEL_READ_TIMEOUT_SECONDS > 0L)
        assertTrue(
            ApiTimeoutPolicy.MODEL_CALL_TIMEOUT_SECONDS >
                ApiTimeoutPolicy.MODEL_READ_TIMEOUT_SECONDS
        )
        assertTrue(ApiTimeoutPolicy.MODEL_READ_TIMEOUT_SECONDS <= 12L)
        assertTrue(ApiTimeoutPolicy.MODEL_CALL_TIMEOUT_SECONDS <= 12L)
    }
}
