package com.aaiagent.engine.observability

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class AccessibilityEventRecord(
    val phase: String,
    val wallTimeMs: Long,
    val bootTimeMs: Long,
    val eventTimeMs: Long,
    val eventType: String = "",
    val packageName: String = "",
    val className: String = "",
    val windowId: Int = -1,
    val activeWindow: Boolean = false,
    val platform: String = "",
    val pageKind: String = "",
    val contactName: String = "",
    val engineState: String = "",
    val inChat: Boolean = false,
    val inMessageList: Boolean = false,
    val actionId: String = "",
    val action: String = "",
    val result: String = "",
    val reason: String = "",
    val sourceId: String = "",
    val sourceClass: String = "",
    val sourceText: String = "",
    val sourceDescription: String = "",
    val bounds: String = "",
) {
    fun toLine(): String {
        return listOf(
            phase,
            wallTimeMs,
            bootTimeMs,
            eventTimeMs,
            eventType,
            packageName,
            className,
            windowId,
            activeWindow,
            platform,
            pageKind,
            contactName,
            engineState,
            inChat,
            inMessageList,
            actionId,
            action,
            result,
            reason,
            sourceId,
            sourceClass,
            sourceText,
            sourceDescription,
            bounds,
        ).joinToString(separator = "|", transform = ::escape)
    }

    private fun escape(value: Any?): String {
        return value.toString()
            .replace("\\", "\\\\")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("|", "\\p")
    }
}

object AccessibilityEventJournal {
    private const val FILE_NAME = "device-events.log"
    private const val MAX_FILE_BYTES = 64L * 1024L * 1024L
    @Volatile
    private var file: File? = null

    @Volatile
    private var writer: java.util.concurrent.ExecutorService? = null

    fun init(service: AccessibilityService) {
        file = File(service.filesDir, "journal/$FILE_NAME")
        file?.parentFile?.mkdirs()
        runCatching { file?.createNewFile() }
        val current = writer
        if (current == null || current.isShutdown) {
            writer = Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "device-event-journal").apply { isDaemon = true }
            }
        }
    }

    fun recordAccessibilityEvent(
        event: AccessibilityEvent,
        platform: String,
        pageKind: AutomationPageKind,
        contactName: String,
        engineState: String,
        inChat: Boolean,
        inMessageList: Boolean,
    ) {
        val source = runCatching { event.source }.getOrNull()
        val bounds = source?.let(::boundsOf).orEmpty()
        enqueue(
            AccessibilityEventRecord(
                phase = "accessibility_event",
                wallTimeMs = System.currentTimeMillis(),
                bootTimeMs = SystemClock.uptimeMillis(),
                eventTimeMs = event.eventTime,
                eventType = AccessibilityEvent.eventTypeToString(event.eventType),
                packageName = event.packageName?.toString().orEmpty(),
                className = event.className?.toString().orEmpty(),
                windowId = event.windowId,
                activeWindow = false,
                platform = platform,
                pageKind = pageKind.name,
                contactName = contactName,
                engineState = engineState,
                inChat = inChat,
                inMessageList = inMessageList,
                sourceId = source?.viewIdResourceName.orEmpty(),
                sourceClass = source?.className?.toString().orEmpty(),
                sourceText = source?.text?.toString().orEmpty(),
                sourceDescription = source?.contentDescription?.toString().orEmpty(),
                bounds = bounds,
            )
        )
    }

    fun recordAction(
        phase: String,
        source: String,
        action: String,
        result: String,
        reason: String,
        actionId: String,
    ) {
        enqueue(
            AccessibilityEventRecord(
                phase = phase,
                wallTimeMs = System.currentTimeMillis(),
                bootTimeMs = SystemClock.uptimeMillis(),
                eventTimeMs = SystemClock.uptimeMillis(),
                actionId = actionId,
                action = action,
                result = result,
                reason = reason,
                sourceDescription = source,
            )
        )
    }

    fun shutdown() {
        val current = writer ?: return
        writer = null
        current.shutdown()
        runCatching { current.awaitTermination(1, TimeUnit.SECONDS) }
    }

    private fun enqueue(record: AccessibilityEventRecord) {
        val current = writer ?: return
        runCatching {
            current.execute {
            val target = file ?: return@execute
            runCatching {
                if (target.exists() && target.length() >= MAX_FILE_BYTES) {
                    val previous = File(target.parentFile, "$FILE_NAME.1")
                    if (previous.exists()) previous.delete()
                    target.renameTo(previous)
                }
                target.appendText(record.toLine() + "\n")
            }
        }
        }
    }

    private fun boundsOf(node: AccessibilityNodeInfo): String {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        return "[${rect.left},${rect.top}][${rect.right},${rect.bottom}]"
    }
}
