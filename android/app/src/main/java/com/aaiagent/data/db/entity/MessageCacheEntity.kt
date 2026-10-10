package com.aaiagent.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "message_cache")
data class MessageCacheEntity(
    @PrimaryKey val messageId: String,
    val platform: String,
    val contactId: String,
    val contactName: String,
    val content: String,
    val timestamp: Long = System.currentTimeMillis()
)