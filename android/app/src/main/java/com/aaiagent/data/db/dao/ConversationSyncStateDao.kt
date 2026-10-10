package com.aaiagent.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.aaiagent.data.db.entity.ConversationSyncStateEntity

@Dao
interface ConversationSyncStateDao {
    @Query("SELECT * FROM conversation_sync_state WHERE id = :id")
    suspend fun get(id: String): ConversationSyncStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(state: ConversationSyncStateEntity)
}
