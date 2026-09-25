package com.aaiagent.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity

@Dao
interface MessageSyncOutboxDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(message: MessageSyncOutboxEntity): Long

    @Query("SELECT * FROM message_sync_outbox WHERE nextAttemptAt <= :now ORDER BY createdAt ASC, id ASC LIMIT :limit")
    suspend fun pending(now: Long, limit: Int): List<MessageSyncOutboxEntity>

    @Query("SELECT COUNT(*) FROM message_sync_outbox WHERE nextAttemptAt <= :now")
    suspend fun pendingCount(now: Long): Int

    @Query("DELETE FROM message_sync_outbox WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("UPDATE message_sync_outbox SET attempts = attempts + 1, nextAttemptAt = :nextAttemptAt WHERE id IN (:ids)")
    suspend fun markFailed(ids: List<String>, nextAttemptAt: Long)

    @Query("SELECT COUNT(*) FROM message_sync_outbox")
    suspend fun count(): Int
}
