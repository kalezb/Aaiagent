package com.aaiagent.engine.observability

import java.io.File

object TraceRetentionPolicy {
    const val MAX_AGE_MS = 30L * 24L * 60L * 60L * 1000L
    const val MAX_INCIDENT_FILES = 50

    fun incidentFilesToDelete(
        files: List<File>,
        nowMs: Long = System.currentTimeMillis(),
    ): List<File> {
        val sorted = files.sortedByDescending { it.lastModified() }
        return sorted.filterIndexed { index, file ->
            index >= MAX_INCIDENT_FILES || nowMs - file.lastModified() > MAX_AGE_MS
        }
    }

    fun screenshotFilesToDelete(
        files: List<File>,
        nowMs: Long = System.currentTimeMillis(),
    ): List<File> = files.filter { nowMs - it.lastModified() > MAX_AGE_MS }
}
