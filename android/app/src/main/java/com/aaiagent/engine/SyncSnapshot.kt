package com.aaiagent.engine

import com.google.gson.Gson

data class SyncSnapshotItem(
    val role: String,
    val content: String,
    val createdAt: Long? = null,
    val stableKey: String? = null,
    // 2026-10-07（时间可信）：界面上到底有没有写出这条消息的时间。
    // 写了 → 这是他真实发送的时间；没写 → 只是我们读到它的时间。
    val explicitTime: Boolean? = null,
    // 2026-10-07 方案A：语音的转写与时长一并上传（没有语音时为空/0）。
    val transcript: String? = null,
    val voiceSeconds: Int? = null
)

object SyncSnapshotPolicy {
    fun selectNewItems(
        previous: List<SyncSnapshotItem>,
        current: List<SyncSnapshotItem>,
        hasEstablishedBaseline: Boolean
    ): List<Int> {
        if (!hasEstablishedBaseline || current.isEmpty() || previous.isEmpty()) return emptyList()

        val transcriptUpdates = current.indices.filter { index ->
            val currentItem = current[index]
            val currentKey = currentItem.stableKey.orEmpty().trim()
            if (currentKey.isEmpty() || currentItem.transcript.isNullOrBlank()) return@filter false
            previous.any { old ->
                old.stableKey.orEmpty().trim() == currentKey &&
                    old.transcript.isNullOrBlank()
            }
        }

        val maxOverlap = minOf(previous.size, current.size)
        for (overlap in maxOverlap downTo 1) {
            val sameMessages = previous.takeLast(overlap)
                .zip(current.take(overlap))
                .all { (old, new) -> sameItem(old, new) }
            if (sameMessages) {
                return ((overlap until current.size) + transcriptUpdates)
                    .distinct()
                    .sorted()
            }
        }
        return (fallbackNewIndexes(previous, current) + transcriptUpdates)
            .distinct()
            .sorted()
    }

    private fun sameItem(previous: SyncSnapshotItem, current: SyncSnapshotItem): Boolean {
        val previousKey = previous.stableKey.orEmpty().trim()
        val currentKey = current.stableKey.orEmpty().trim()
        if (previousKey.isNotEmpty() && currentKey.isNotEmpty()) {
            return previousKey == currentKey
        }
        if (previous.role != current.role || previous.content != current.content) return false
        val previousTime = previous.createdAt
        val currentTime = current.createdAt
        return previousTime == null || currentTime == null || previousTime == currentTime
    }

    private fun fallbackNewIndexes(
        previous: List<SyncSnapshotItem>,
        current: List<SyncSnapshotItem>
    ): List<Int> {
        val previousKeys = previous.mapNotNull { item ->
            item.stableKey?.trim()?.takeIf(String::isNotEmpty)
        }.toSet()
        if (previousKeys.isNotEmpty()) {
            val unseenByKey = current.indices.filter { index ->
                val key = current[index].stableKey?.trim().orEmpty()
                key.isNotEmpty() && key !in previousKeys
            }
            if (unseenByKey.isNotEmpty()) return unseenByKey
        }

        val lastKnownTime = previous.mapNotNull { it.createdAt }.maxOrNull()
        if (lastKnownTime == null) return emptyList()
        return current.indices.filter { index ->
            val item = current[index]
            val createdAt = item.createdAt
            val key = item.stableKey?.trim().orEmpty()
            createdAt != null &&
                createdAt >= lastKnownTime &&
                (key.isEmpty() || key !in previousKeys) &&
                previous.none { old -> sameItem(old, item) }
        }
    }
}

object SyncSnapshotCodec {
    private val gson = Gson()

    fun encode(items: List<SyncSnapshotItem>): String = gson.toJson(items)

    fun decode(value: String?): List<SyncSnapshotItem> {
        if (value.isNullOrBlank()) return emptyList()
        return runCatching {
            gson.fromJson(value, Array<SyncSnapshotItem>::class.java)?.toList().orEmpty()
        }.getOrDefault(emptyList())
    }
}
