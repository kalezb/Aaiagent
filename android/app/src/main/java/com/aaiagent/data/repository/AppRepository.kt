package com.aaiagent.data.repository

import androidx.room.withTransaction
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.ConversationSyncStateEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.MessageSyncOutboxEntity
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity

class AppRepository(private val db: AppDatabase) {

    // Token 名称统一 trim，避免前后空格导致后端验证失败。
    fun getActiveToken(): TokenEntity? = db.tokenDao().getActiveToken()?.let {
        val trimmed = it.token.trim()
        if (trimmed != it.token) it.copy(token = trimmed) else it
    }
    fun activateVerifiedToken(token: String) {
        val normalized = token.trim()
        require(normalized.isNotEmpty())
        db.tokenDao().clearActive()
        db.tokenDao().insert(TokenEntity(token = normalized, isActive = true))
    }
    fun getAllTokens(): List<TokenEntity> = db.tokenDao().getAll()
    fun saveToken(token: TokenEntity) = db.tokenDao().insert(token.copy(token = token.token.trim()))
    fun setTokenActive(token: String, active: Boolean) = db.tokenDao().setActive(token.trim(), active)

    // Config
    fun getConfig(key: String): String? = db.configDao().getValue(key)
    fun setConfig(key: String, value: String) = db.configDao().set(ConfigEntity(key, value))

    fun getApiBaseUrl(): String = getConfig("api_base_url") ?: "https://ai-agent-api.pages.dev"
    fun getPersonaId(): String = getConfig("persona_id") ?: "female"

    // Contact filters
    fun getContactWhitelist(): List<String> = ContactListCodec.decode(getConfig(CONFIG_WHITELIST))
    fun setContactWhitelist(values: List<String>) = setConfig(CONFIG_WHITELIST, ContactListCodec.encode(values))
    fun getContactBlacklist(): List<String> = ContactListCodec.decode(getConfig(CONFIG_BLACKLIST))
    fun setContactBlacklist(values: List<String>) = setConfig(CONFIG_BLACKLIST, ContactListCodec.encode(values))

    // Location
    fun getLocation(): Map<String, Map<String, String>> {
        val loc = db.userLocationDao().get() ?: UserLocationEntity()
        return mapOf(
            "home" to mapOf(
                "city" to loc.homeCity.ifEmpty { "重庆" },
                "district" to loc.homeDistrict.ifEmpty { "两江新区" }
            ),
            "work" to mapOf(
                "city" to loc.workCity.ifEmpty { "重庆" },
                "district" to loc.workDistrict.ifEmpty { "两江新区" }
            )
        )
    }

    fun setLocation(homeCity: String, homeDistrict: String, workCity: String, workDistrict: String) {
        db.userLocationDao().set(UserLocationEntity(
            homeCity = homeCity, homeDistrict = homeDistrict,
            workCity = workCity, workDistrict = workDistrict
        ))
    }

    // Message Cache (dedup)
    fun isDuplicate(messageId: String): Boolean = db.messageCacheDao().getByMessageId(messageId) != null
    fun cacheMessage(messageId: String, platform: String, contactId: String, contactName: String, content: String) {
        db.messageCacheDao().insert(MessageCacheEntity(messageId, platform, contactId, contactName, content))
    }
    suspend fun enqueueSyncMessage(message: MessageSyncOutboxEntity) {
        db.messageSyncOutboxDao().insert(message)
    }

    suspend fun getConversationSyncState(id: String): ConversationSyncStateEntity? {
        return db.conversationSyncStateDao().get(id)
    }

    suspend fun persistSyncSnapshot(
        state: ConversationSyncStateEntity,
        messages: List<MessageSyncOutboxEntity>
    ): Int = db.withTransaction {
        var inserted = 0
        for (message in messages) {
            if (db.messageCacheDao().getByMessageId(message.id) != null) continue
            db.messageCacheDao().insert(
                MessageCacheEntity(
                    messageId = message.id,
                    platform = message.platform,
                    contactId = message.contactId,
                    contactName = message.contactName,
                    content = message.content
                )
            )
            db.messageSyncOutboxDao().insert(message)
            inserted++
        }
        db.conversationSyncStateDao().upsert(state)
        inserted
    }

    suspend fun pendingSyncMessages(now: Long, limit: Int = 100): List<MessageSyncOutboxEntity> {
        return db.messageSyncOutboxDao().pending(now, limit)
    }

    suspend fun deleteSyncMessages(ids: List<String>) {
        if (ids.isNotEmpty()) db.messageSyncOutboxDao().deleteByIds(ids)
    }

    suspend fun markSyncMessagesFailed(ids: List<String>, nextAttemptAt: Long) {
        if (ids.isNotEmpty()) db.messageSyncOutboxDao().markFailed(ids, nextAttemptAt)
    }

    suspend fun syncOutboxCount(): Int = db.messageSyncOutboxDao().count()

    fun cleanOldCache() {
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        db.messageCacheDao().deleteOlderThan(cutoff)
    }
}

private const val CONFIG_WHITELIST = "contact_whitelist"
private const val CONFIG_BLACKLIST = "contact_blacklist"
