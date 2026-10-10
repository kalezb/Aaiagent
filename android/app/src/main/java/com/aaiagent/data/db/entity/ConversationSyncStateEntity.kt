package com.aaiagent.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "conversation_sync_state")
data class ConversationSyncStateEntity(
    @PrimaryKey val id: String,
    val platform: String,
    val contactId: String,
    val snapshotJson: String,
    val nextSequence: Long,
    val updatedAt: Long = System.currentTimeMillis()
)
