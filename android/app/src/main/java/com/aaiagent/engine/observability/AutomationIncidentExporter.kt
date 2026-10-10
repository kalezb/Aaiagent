package com.aaiagent.engine.observability

import java.io.File
import android.util.Base64

class AutomationIncidentExporter(
    private val directory: File,
) {
    fun export(
        incidentId: String,
        events: List<AutomationEvent>,
    ): File? {
        if (incidentId.isBlank() || events.isEmpty()) return null
        val incidentsDir = File(directory, "incidents").apply { mkdirs() }
        val target = File(incidentsDir, "incident-$incidentId.jsonl")
        return runCatching {
            target.writeText(
                events.joinToString(separator = "\n", postfix = "\n") {
                    AutomationEventCodec.toJson(withScreenshotData(it))
                }
            )
            target
        }.getOrNull()
    }

    private fun withScreenshotData(event: AutomationEvent): AutomationEvent {
        if (event.screenshotRef.isBlank() || event.screenshotData.isNotBlank()) return event
        val screenshot = File(directory, event.screenshotRef)
        if (!screenshot.exists() || !screenshot.isFile) return event
        val encoded = runCatching {
            Base64.encodeToString(screenshot.readBytes(), Base64.NO_WRAP)
        }.getOrDefault("")
        return if (encoded.isBlank()) event else event.copy(screenshotData = encoded)
    }
}
