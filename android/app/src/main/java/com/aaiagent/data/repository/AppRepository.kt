package com.aaiagent.data.repository

import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.db.entity.ConfigEntity
import com.aaiagent.data.db.entity.MessageCacheEntity
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity

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
    fun cleanOldCache() {
        val cutoff = System.currentTimeMillis() - 5 * 60 * 1000
        db.messageCacheDao().deleteOlderThan(cutoff)
    }
}
