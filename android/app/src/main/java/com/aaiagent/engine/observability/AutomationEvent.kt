package com.aaiagent.engine.observability

import java.util.UUID

enum class AutomationPageKind {
    UNKNOWN,
    CONVERSATION_LIST,
    VERIFIED_CHAT,
    PROFILE_PAGE,
    MEDIA_PAGE,
    DIALOG,
}

data class AutomationEvent(
    val eventId: String = UUID.randomUUID().toString(),
    val timestampMs: Long = System.currentTimeMillis(),
    val monotonicMs: Long = System.nanoTime() / 1_000_000L,
    val traceId: String = "",
    val transactionId: String = "",
    val incidentId: String = "",
    val platform: String = "",
    val contactId: String = "",
    val stage: String = "",
    val fromState: String = "",
    val action: String = "",
    val expectedState: String = "",
    val observedState: String = "",
    val result: String = "",
    val reason: String = "",
    val event: String = "",
    val pageKind: AutomationPageKind = AutomationPageKind.UNKNOWN,
    val nodeFingerprint: String = "",
    val unreadCount: Int = 0,
    val listFingerprint: String = "",
    val contentPreview: String = "",
    val payloadJson: String = "",
    val screenshotRef: String = "",
    val screenshotData: String = "",
    val recoveryAction: String = "",
    val elapsedMs: Long? = null,
    val appVersion: String = "",
    val personaId: String = "",
    val personaVersion: Int = 0,
    val modelLine: String = "",
    val modelName: String = "",
)

object AutomationIds {
    fun traceId(prefix: String = "trace"): String = "$prefix-${UUID.randomUUID()}"

    fun transactionId(prefix: String = "tx"): String = "$prefix-${UUID.randomUUID()}"

    fun incidentId(): String = "inc-${UUID.randomUUID()}"
}
