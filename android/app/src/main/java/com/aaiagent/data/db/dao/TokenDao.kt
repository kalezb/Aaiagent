package com.aaiagent.data.db.dao

import androidx.room.*
import com.aaiagent.data.db.entity.TokenEntity

@Dao
interface TokenDao {
    @Query("SELECT * FROM tokens WHERE isActive = 1 LIMIT 1")
    fun getActiveToken(): TokenEntity?

    @Query("SELECT * FROM tokens")
    fun getAll(): List<TokenEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insert(token: TokenEntity)

    @Query("UPDATE tokens SET isActive = :active WHERE token = :token")
    fun setActive(token: String, active: Boolean)

    @Query("UPDATE tokens SET isActive = 0")
    fun clearActive()

    @Query("DELETE FROM tokens WHERE token = :token")
    fun delete(token: String)
}
