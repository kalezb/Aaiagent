package com.aaiagent.engine

import com.aaiagent.network.ChatResponse
import com.aaiagent.network.NetworkTiming
import java.util.concurrent.TimeUnit

sealed class EngineState {
    object Idle : EngineState()
    object ScanningConversations : EngineState()
    object ReadingMessages : EngineState()
    object WaitingLLM : EngineState()
    object AboutToSend : EngineState()
    object Sending : EngineState()
    object Paused : EngineState()
    object Error : EngineState()
}

enum class HostingMode {
    FULL_AUTO,
    SEMI_AUTO,
    MONITOR_ONLY
}

internal fun elapsedMillis(startedAtNanos: Long, endedAtNanos: Long = System.nanoTime()): Long {
    return TimeUnit.NANOSECONDS.toMillis((endedAtNanos - startedAtNanos).coerceAtLeast(0L))
}

private fun timingValue(value: Long?): String = value?.toString() ?: "-"

internal fun modelTimingLog(
    stage: String,
    suffix: String,
    requestId: String,
    response: ChatResponse,
    networkTiming: NetworkTiming,
    clientPrepareMs: Long,
    clientHttpMs: Long,
    clientTotalMs: Long
): String {
    val serverTiming = response.timing
    return "chat_timing stage=$stage $suffix requestId=$requestId " +
        "serverRequestId=${response.requestId.orEmpty().ifBlank { "-" }} " +
        "client_prepare_ms=$clientPrepareMs client_http_ms=$clientHttpMs client_total_ms=$clientTotalMs " +
        "dns_ms=${timingValue(networkTiming.dnsMs)} " +
        "connect_ms=${timingValue(networkTiming.connectMs)} " +
        "tls_ms=${timingValue(networkTiming.tlsMs)} " +
        "request_ms=${timingValue(networkTiming.requestMs)} " +
        "ttfb_ms=${timingValue(networkTiming.ttfbMs)} " +
        "response_body_ms=${timingValue(networkTiming.responseBodyMs)} " +
        "network_total_ms=${timingValue(networkTiming.totalMs)} " +
        "server_persona_ms=${timingValue(serverTiming?.personaMs)} " +
        "server_context_ms=${timingValue(serverTiming?.contextMs)} " +
        "server_llm_ms=${timingValue(serverTiming?.llmMs)} " +
        "server_main_llm_ms=${timingValue(serverTiming?.mainLlmMs)} " +
        "server_repair_ms=${timingValue(serverTiming?.repairMs)} " +
        "server_repair_attempted=${serverTiming?.repairAttempted ?: false} " +
        "server_repair_timeout=${serverTiming?.repairTimeout ?: false} " +
        "server_total_ms=${timingValue(serverTiming?.totalMs)}"
}

internal fun logModelTiming(
    stage: String,
    suffix: String,
    requestId: String,
    response: ChatResponse,
    networkTiming: NetworkTiming,
    clientPrepareMs: Long,
    clientHttpMs: Long,
    clientTotalMs: Long
) {
    val message = modelTimingLog(
        stage = stage,
        suffix = suffix,
        requestId = requestId,
        response = response,
        networkTiming = networkTiming,
        clientPrepareMs = clientPrepareMs,
        clientHttpMs = clientHttpMs,
        clientTotalMs = clientTotalMs
    )
    if (ChatLatencyPolicy.isSlow(clientTotalMs)) {
        android.util.Log.w("AIA", "chat_slow $message")
    } else {
        android.util.Log.d("AIA", message)
    }
}
