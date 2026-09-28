package com.aaiagent.data.db.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_reply_confirmations",
    indices = [Index(value = ["nextAttemptAt", "createdAt"])]
)
data class PendingReplyConfirmationEntity(
    @PrimaryKey val replyId: String,
    val token: String,
    val sentContent: String,
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0L,
)
