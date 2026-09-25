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
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0L
)
