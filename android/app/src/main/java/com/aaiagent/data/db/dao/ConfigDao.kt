package com.aaiagent.data.db.dao

import androidx.room.*
import com.aaiagent.data.db.entity.ConfigEntity

@Dao
interface ConfigDao {
    @Query("SELECT value FROM config WHERE `key` = :key")
    fun getValue(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun set(config: ConfigEntity)

    @Query("DELETE FROM config WHERE `key` = :key")
    fun delete(key: String)
}