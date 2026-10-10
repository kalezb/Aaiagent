package com.aaiagent.engine.observability

import com.aaiagent.engine.TraceEvent
import com.aaiagent.engine.automation.AutomationRecoveryPolicy
import java.io.File
import android.util.Base64

object AutomationTrace {
    private val lock = Any()
    private val ring = TraceRingBuffer()
    private val anomalyDetector = AutomationAnomalyDetector()
    private var persistence: TracePersistence? = null
    private var exporter: AutomationIncidentExporter? = null
    private var appVersion = ""
    private var personaId = ""
    private var personaVersion = 0
    private var modelLine = ""
    private var modelName = ""
    private var initialized = false
    private var lastContentChangeAtMs = 0L
    private var lastContentChangeKey = ""
    private var suppressedContentChanges = 0
    private var refreshStormPausedUntilMs = 0L
    private var latestIncidentId = ""

    fun init(directory: File, versionName: String = "") {
        synchronized(lock) {
            if (initialized) return
            appVersion = versionName
            personaId = ""
            personaVersion = 0
            modelLine = ""
            modelName = ""
            ring.clear()
            anomalyDetector.reset()
            refreshStormPausedUntilMs = 0L
            latestIncidentId = ""
            persistence = TracePersistence(directory).also { it.start() }
            exporter = AutomationIncidentExporter(directory)
            cleanupArtifacts(directory)
            initialized = true
        }
    }

    fun shutdown() {
        synchronized(lock) {
            persistence?.shutdown()
            persistence = null
            exporter = null
            initialized = false
        }
    }

    fun newTraceId(prefix: String = "trace"): String = AutomationIds.traceId(prefix)

    fun newTransactionId(prefix: String = "tx"): String = AutomationIds.transactionId(prefix)

    fun updateContext(
        personaId: String,
        personaVersion: Int,
        modelLine: String,
        modelName: String,
    ) {
        synchronized(lock) {
            this.personaId = personaId.trim()
            this.personaVersion = personaVersion
            this.modelLine = modelLine.trim()
            this.modelName = modelName.trim()
        }
    }

    fun recordPageObservation(
        platform: String,
        contactId: String,
        pageKind: AutomationPageKind,
        source: String,
        engineState: String,
        nodeFingerprint: String,
        hostingEnabled: Boolean,
        traceId: String = "",
    ) {
        record(
            AutomationEvent(
                traceId = traceId,
                platform = platform,
                contactId = contactId,
                stage = "page",
                event = "page_observed",
                action = source,
                fromState = engineState,
                observedState = pageKind.name,
                result = if (hostingEnabled) "hosting" else "monitor",
                pageKind = pageKind,
                nodeFingerprint = nodeFingerprint,
            )
        )
    }

    fun recordContentChange(
        platform: String,
        engineState: String,
        source: String,
        traceId: String = "",
    ) {
        val event = AutomationEvent(
            traceId = traceId,
            platform = platform,
            stage = "content_change",
            event = "content_changed",
            action = source,
            fromState = engineState,
            result = "observed",
        )
        synchronized(lock) {
            val anomaly = anomalyDetector.observe(event)
            if (anomaly != null) {
                emitAnomaly(anomaly, event)
                return
            }
            val key = "$platform|$engineState|$source"
            val now = event.timestampMs
            if (key == lastContentChangeKey && now - lastContentChangeAtMs < CONTENT_CHANGE_COALESCE_MS) {
                suppressedContentChanges += 1
                return
            }
            lastContentChangeKey = key
            lastContentChangeAtMs = now
            val reason = if (suppressedContentChanges > 0) {
                "suppressed=$suppressedContentChanges"
            } else {
                ""
            }
            suppressedContentChanges = 0
            record(event.copy(reason = reason), detectAnomalies = false)
        }
    }

    fun recordUiAction(
        platform: String,
        source: String,
        action: String,
        result: String,
        expectedState: String = "",
        observedState: String = "",
        reason: String = "",
        traceId: String = "",
        transactionId: String = "",
    ) {
        AccessibilityEventJournal.recordAction(
            phase = "automation_action",
            source = source,
            action = action,
            result = result,
            reason = reason,
            actionId = transactionId.ifBlank { traceId },
        )
        record(
            AutomationEvent(
                traceId = traceId,
                transactionId = transactionId,
                platform = platform,
                stage = "ui_action",
                event = "ui_action",
                action = action,
                expectedState = expectedState,
                observedState = observedState,
                result = result,
                reason = reason,
                contentPreview = source.take(120),
            )
        )
    }

    fun recordLegacyTrace(event: TraceEvent) {
        record(
            AutomationEvent(
                traceId = event.traceId,
                platform = event.platform,
                contactId = event.contactId,
                stage = event.stage,
                event = event.event,
                expectedState = "",
                observedState = "",
                result = event.result,
                reason = event.reason,
                elapsedMs = event.elapsedMs,
            )
        )
    }

    fun recordRuleAudit(
        source: String,
        reason: String,
        overrides: List<Triple<String, String, String>>,
    ) {
        if (overrides.isEmpty()) {
            record(
                AutomationEvent(
                    stage = "rule_audit",
                    event = "rule_decision",
                    action = source.ifBlank { "unknown" },
                    result = reason.ifBlank { "no_override" },
                )
            )
            return
        }
        overrides.forEach { (rule, overrideReason, beforeAfter) ->
            record(
                AutomationEvent(
                    stage = "rule_audit",
                    event = "rule_applied",
                    action = rule.ifBlank { "unknown" },
                    result = overrideReason.ifBlank { "applied" },
                    reason = beforeAfter.take(500),
                )
            )
        }
    }

    fun markUserFeedback(reason: String): File? {
        val incidentId = AutomationIds.incidentId()
        val now = System.currentTimeMillis()
        record(
            AutomationEvent(
                incidentId = incidentId,
                stage = "feedback",
                event = "user_feedback",
                result = "reported",
                reason = reason.take(500),
                timestampMs = now,
            )
        )
        return exportIncident(incidentId)
    }

    fun exportIncident(incidentId: String): File? {
        val snapshot = ring.snapshot()
        return exporter?.export(incidentId, snapshot)
    }

    fun snapshot(): List<AutomationEvent> = ring.snapshot()

    fun refreshStormPauseRemainingMs(nowMs: Long = System.currentTimeMillis()): Long {
        synchronized(lock) {
            return (refreshStormPausedUntilMs - nowMs).coerceAtLeast(0L)
        }
    }

    fun latestIncidentId(): String = synchronized(lock) {
        latestIncidentId
    }

    fun attachScreenshot(
        stage: String,
        jpegBase64: String,
        incidentId: String = latestIncidentId(),
    ): String? {
        if (incidentId.isBlank() || jpegBase64.isBlank()) return null
        val directory = persistenceDirectory()?.let { File(it, "screenshots") } ?: return null
        directory.mkdirs()
        val safeStage = stage.replace(Regex("[^A-Za-z0-9._-]"), "_").take(40)
        val file = File(directory, "incident-$incidentId-$safeStage.jpg")
        val saved = runCatching {
            file.writeBytes(Base64.decode(jpegBase64, Base64.DEFAULT))
            file
        }.getOrNull() ?: return null
        val reference = "screenshots/${saved.name}"
        record(
            AutomationEvent(
                incidentId = incidentId,
                stage = "screenshot",
                event = "screenshot_captured",
                action = stage,
                result = "saved",
                screenshotRef = reference,
            )
        )
        exporter?.export(incidentId, ring.snapshot())
        return reference
    }

    private fun record(event: AutomationEvent, detectAnomalies: Boolean = true) {
        synchronized(lock) {
            val versioned = enrich(event)
            val anomaly = if (detectAnomalies) anomalyDetector.observe(versioned) else null
            if (anomaly == null) {
                emit(versioned)
                return
            }

            emitAnomaly(anomaly, versioned)
        }
    }

    private fun emitAnomaly(anomaly: AutomationAnomaly, sourceEvent: AutomationEvent) {
        val versioned = enrich(sourceEvent)
        val incidentId = versioned.incidentId.ifBlank { AutomationIds.incidentId() }
        latestIncidentId = incidentId
        val incidentEvent = versioned.copy(
            eventId = AutomationIds.traceId("event"),
            incidentId = incidentId,
            event = "anomaly",
            action = anomaly.type,
            result = "anomaly",
            reason = anomaly.reason,
        )
        if (anomaly.type == "ConversationListRefreshStorm") {
            refreshStormPausedUntilMs = AutomationRecoveryPolicy.refreshStormPausedUntil(
                versioned.timestampMs
            )
        }
        emit(versioned.copy(incidentId = incidentId))
        emit(incidentEvent)
        exporter?.export(incidentId, ring.snapshot())
    }

    private fun enrich(event: AutomationEvent): AutomationEvent {
        return event.copy(
            appVersion = event.appVersion.ifBlank { appVersion },
            personaId = event.personaId.ifBlank { personaId },
            personaVersion = if (event.personaVersion == 0) personaVersion else event.personaVersion,
            modelLine = event.modelLine.ifBlank { modelLine },
            modelName = event.modelName.ifBlank { modelName },
        )
    }

    private fun emit(event: AutomationEvent) {
        ring.add(event)
        persistence?.enqueue(event)
    }

    private fun persistenceDirectory(): File? {
        return persistence?.directory()
    }

    private fun cleanupArtifacts(directory: File) {
        runCatching {
            val incidents = File(directory, "incidents")
                .listFiles { file -> file.isFile && file.name.endsWith(".jsonl") }
                ?.toList()
                .orEmpty()
            TraceRetentionPolicy.incidentFilesToDelete(incidents).forEach { it.delete() }

            val screenshots = File(directory, "screenshots")
                .listFiles { file -> file.isFile && file.name.endsWith(".jpg") }
                ?.toList()
                .orEmpty()
            TraceRetentionPolicy.screenshotFilesToDelete(screenshots).forEach { it.delete() }
        }
    }

    private const val CONTENT_CHANGE_COALESCE_MS = 250L
}
