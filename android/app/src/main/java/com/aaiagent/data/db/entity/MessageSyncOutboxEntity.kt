package com.aaiagent.data.db.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "message_sync_outbox",
    indices = [Index(value = ["nextAttemptAt", "createdAt"])]
)
data class MessageSyncOutboxEntity(
    @PrimaryKey val id: String,
    val token: String,
    val platform: String,
    val contactId: String,
    val contactName: String,
    val role: String,
    val content: String,
    val source: String,
    val createdAt: Long = System.currentTimeMillis(),
    // 2026-10-07：这条消息的时间来源（ui_explicit=界面写了时间 / first_observed=我们读到的）。
    val timeKind: String = "",
    // 2026-10-07 方案A：语音转写与时长（用于把转写补进云端历史）。
    val transcript: String = "",
    val voiceSeconds: Int = 0,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0L
)
