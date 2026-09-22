package com.aaiagent.data.repository

import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.TokenEntity

class AppRepository(private val db: AppDatabase) {

    // Token
    fun getActiveToken(): TokenEntity? = db.tokenDao().getActiveToken()
    fun getAllTokens(): List<TokenEntity> = db.tokenDao().getAll()
    fun saveToken(token: TokenEntity) = db.tokenDao().insert(token)
    fun setTokenActive(token: String, active: Boolean) = db.tokenDao().setActive(token, active)

    // Config
    fun getConfig(key: String): String? = db.configDao().getValue(key)
    fun setConfig(key: String, value: String) = db.configDao().set(ConfigEntity(key, value))

    fun getApiBaseUrl(): String = getConfig("api_base_url") ?: "https://ai-agent-api.pages.dev"
    fun getPersonaId(): String = getConfig("persona_id") ?: "male"

    // Message Cache (dedup)
    fun isDuplicate(messageId: String): Boolean = db.messageCacheDao().getByMessageId(messageId) != null
    fun cacheMessage(messageId: String, platform: String, contactId: String, contactName: String, content: String) {
        db.messageCacheDao().insert(MessageCacheEntity(messageId, platform, contactId, contactName, content))
    }
    fun cleanOldCache() {
        val cutoff = System.currentTimeMillis() - 5 * 60 * 1000 // 5 minutes
        db.messageCacheDao().deleteOlderThan(cutoff)
    }
}