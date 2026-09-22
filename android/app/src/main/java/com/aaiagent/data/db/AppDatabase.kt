package com.aaiagent.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.aaiagent.data.db.dao.ConfigDao
import com.aaiagent.data.db.dao.MessageCacheDao
import com.aaiagent.data.db.dao.TokenDao
import com.aaiagent.data.db.dao.UserLocationDao
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity

@Database(
    entities = [
        TokenEntity::class,
        ConfigEntity::class,
        MessageCacheEntity::class,
        UserLocationEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tokenDao(): TokenDao
    abstract fun configDao(): ConfigDao
    abstract fun messageCacheDao(): MessageCacheDao
    abstract fun userLocationDao(): UserLocationDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "aaiagent.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
