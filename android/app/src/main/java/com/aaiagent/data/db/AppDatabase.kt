package com.aaiagent.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.aaiagent.data.db.dao.ConfigDao
import com.aaiagent.data.db.dao.ConversationSyncStateDao
import com.aaiagent.data.db.dao.MessageCacheDao
import com.aaiagent.data.db.dao.MessageSyncOutboxDao
import com.aaiagent.data.db.dao.TokenDao
import com.aaiagent.data.db.dao.UserLocationDao
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity

@Database(
    entities = [
        TokenEntity::class,
        ConfigEntity::class,
        MessageCacheEntity::class,
        ConversationSyncStateEntity::class,
        MessageSyncOutboxEntity::class,
        UserLocationEntity::class
    ],
    version = 4,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tokenDao(): TokenDao
    abstract fun configDao(): ConfigDao
    abstract fun messageCacheDao(): MessageCacheDao
    abstract fun conversationSyncStateDao(): ConversationSyncStateDao
    abstract fun messageSyncOutboxDao(): MessageSyncOutboxDao
    abstract fun userLocationDao(): UserLocationDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `user_location` (
                        `id` INTEGER NOT NULL,
                        `home_city` TEXT NOT NULL,
                        `home_district` TEXT NOT NULL,
                        `work_city` TEXT NOT NULL,
                        `work_district` TEXT NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
            }
        }

        private val MIGRATION_2_4 = object : Migration(2, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `conversation_sync_state` (
                        `id` TEXT NOT NULL,
                        `platform` TEXT NOT NULL,
                        `contactId` TEXT NOT NULL,
                        `snapshotJson` TEXT NOT NULL,
                        `nextSequence` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `message_sync_outbox` (
                        `id` TEXT NOT NULL,
                        `token` TEXT NOT NULL,
                        `platform` TEXT NOT NULL,
                        `contactId` TEXT NOT NULL,
                        `contactName` TEXT NOT NULL,
                        `role` TEXT NOT NULL,
                        `content` TEXT NOT NULL,
                        `source` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `attempts` INTEGER NOT NULL,
                        `nextAttemptAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_message_sync_outbox_nextAttemptAt_createdAt` " +
                        "ON `message_sync_outbox` (`nextAttemptAt`, `createdAt`)"
                )
            }
        }

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "aaiagent.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_4)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
