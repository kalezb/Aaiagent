package com.aaiagent.data.db.dao

import androidx.room.*
import com.aaiagent.data.db.entity.MessageCacheEntity

@Dao
interface MessageCacheDao {
    @Query("SELECT * FROM message_cache WHERE messageId = :messageId")
    fun getByMessageId(messageId: String): MessageCacheEntity?

    @Query("SELECT * FROM message_cache WHERE timestamp < :before")
    fun getOlderThan(before: Long): List<MessageCacheEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insert(msg: MessageCacheEntity)

    @Query("DELETE FROM message_cache WHERE messageId = :messageId")
    fun delete(messageId: String)

    @Query("DELETE FROM message_cache WHERE timestamp < :before")
    fun deleteOlderThan(before: Long)

    @Query("SELECT COUNT(*) FROM message_cache")
    fun count(): Int
}