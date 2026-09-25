package com.aaiagent.engine

import com.google.gson.Gson

data class SyncSnapshotItem(
    val role: String,
    val content: String
)

object SyncSnapshotPolicy {
    fun selectNewItems(
        previous: List<SyncSnapshotItem>,
        current: List<SyncSnapshotItem>
    ): List<Int> {
        if (current.isEmpty()) return emptyList()
        if (previous.isEmpty()) return current.indices.toList()

        val maxOverlap = minOf(previous.size, current.size)
        for (overlap in maxOverlap downTo 1) {
            if (previous.takeLast(overlap) == current.take(overlap)) {
                return (overlap until current.size).toList()
            }
        }
        return current.indices.toList()
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
