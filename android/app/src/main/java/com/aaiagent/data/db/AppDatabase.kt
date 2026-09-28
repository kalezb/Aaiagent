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
import com.aaiagent.data.db.dao.PendingReplyConfirmationDao
import com.aaiagent.data.db.dao.TokenDao
import com.aaiagent.data.db.dao.UserLocationDao
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.data.db.entity.PendingReplyConfirmationEntity
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity

@Database(
    entities = [
        TokenEntity::class,
        ConfigEntity::class,
        MessageCacheEntity::class,
        ConversationSyncStateEntity::class,
        MessageSyncOutboxEntity::class,
        PendingReplyConfirmationEntity::class,
        UserLocationEntity::class,
    ],
    version = 5,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tokenDao(): TokenDao
    abstract fun configDao(): ConfigDao
    abstract fun messageCacheDao(): MessageCacheDao
    abstract fun conversationSyncStateDao(): ConversationSyncStateDao
    abstract fun messageSyncOutboxDao(): MessageSyncOutboxDao
    abstract fun pendingReplyConfirmationDao(): PendingReplyConfirmationDao
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

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `pending_reply_confirmations` (
                        `replyId` TEXT NOT NULL,
                        `token` TEXT NOT NULL,
                        `sentContent` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `attempts` INTEGER NOT NULL,
                        `nextAttemptAt` INTEGER NOT NULL,
                        PRIMARY KEY(`replyId`)
                    )
                    """.trimIndent()
                )
                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_pending_reply_confirmations_nextAttemptAt_createdAt` " +
                        "ON `pending_reply_confirmations` (`nextAttemptAt`, `createdAt`)"
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
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_4, MIGRATION_4_5)
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
