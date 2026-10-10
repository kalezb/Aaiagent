package com.aaiagent.engine.sampling

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class PageNodeSample(
    val index: Int,
    val parentIndex: Int,
    val depth: Int,
    val className: String,
    val viewId: String,
    val text: String,
    val contentDescription: String,
    val clickable: Boolean,
    val editable: Boolean,
    val scrollable: Boolean,
    val enabled: Boolean,
    val visible: Boolean,
    val focused: Boolean,
    val selected: Boolean,
    val checked: Boolean,
    val bounds: List<Int>,
)

data class PageSampleMessage(
    val sender: String,
    val type: String,
    val content: String,
    val identityKey: String,
    val timestampText: String,
)

data class PageWindowSample(
    val layer: Int,
    val type: Int,
    val packageName: String,
    val active: Boolean,
    val focused: Boolean,
    val nodeCount: Int,
    val nodes: List<PageNodeSample>,
)

data class PageSamplePayload(
    val sampleId: String,
    val sequence: Int,
    val platform: String,
    val packageName: String,
    val pageKind: String,
    val pageReason: String,
    val chatTitle: String,
    val screenWidth: Int,
    val screenHeight: Int,
    val density: Float,
    val fontScale: Float,
    val appVersion: String,
    val capturedAtMs: Long,
    val nodeCount: Int,
    val listSnapshot: List<String>,
    val visibleUnreadCount: Int,
    val messages: List<PageSampleMessage>,
    val nodes: List<PageNodeSample>,
    val windows: List<PageWindowSample>,
)

data class PageSampleResult(
    val sampleId: String,
    val sequence: Int,
    val platform: String,
    val pageKind: String,
    val chatTitle: String,
    val nodeCount: Int,
    val screenshotCaptured: Boolean,
    val localFile: String,
    val uploaded: Boolean,
)

object PageSampleNamingPolicy {
    fun safeSegment(value: String, fallback: String = "unknown"): String {
        val cleaned = value
            .trim()
            .replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_")
            .replace(Regex("_+"), "_")
            .trim('_')
            .take(48)
        return cleaned.ifBlank { fallback }
    }

    fun incidentId(platform: String, sequence: Int, pageKind: String, nowMs: Long): String {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(nowMs))
        return listOf(
            "page-sample",
            safeSegment(platform),
            sequence.coerceAtLeast(0).toString().padStart(4, '0'),
            safeSegment(pageKind),
            stamp,
        ).joinToString("-")
    }

    fun fileName(incidentId: String): String = "incident-$incidentId.jsonl"
}
