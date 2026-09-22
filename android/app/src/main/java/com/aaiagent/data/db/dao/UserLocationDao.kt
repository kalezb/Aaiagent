package com.aaiagent.data.db.dao

import androidx.room.*
import com.aaiagent.data.db.entity.UserLocationEntity

@Dao
interface UserLocationDao {
    @Query("SELECT * FROM user_location WHERE id = 1")
    fun get(): UserLocationEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun set(location: UserLocationEntity)
}
