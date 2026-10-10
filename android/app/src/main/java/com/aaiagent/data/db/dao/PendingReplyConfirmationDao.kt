package com.aaiagent.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.aaiagent.data.db.entity.PendingReplyConfirmationEntity

@Dao
interface PendingReplyConfirmationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: PendingReplyConfirmationEntity)

    @Query("SELECT * FROM pending_reply_confirmations WHERE nextAttemptAt <= :now ORDER BY createdAt ASC LIMIT :limit")
    suspend fun pending(now: Long, limit: Int): List<PendingReplyConfirmationEntity>

    @Query("DELETE FROM pending_reply_confirmations WHERE replyId = :replyId")
    suspend fun delete(replyId: String)

    @Query("UPDATE pending_reply_confirmations SET attempts = attempts + 1, nextAttemptAt = :nextAttemptAt WHERE replyId = :replyId")
    suspend fun markFailed(replyId: String, nextAttemptAt: Long)
}
