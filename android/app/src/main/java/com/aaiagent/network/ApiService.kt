package com.aaiagent.network

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class ChatRequest(
    val token: String,
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, String>>,
    val location: Map<String, Map<String, String>>? = null
)

data class ChatResponse(
    val action: String?,
    val reply: String?,
    val error: String?
)

data class ConfigResponse(
    @SerializedName("active_persona_id") val activePersonaId: String?,
    @SerializedName("active_persona_name") val activePersonaName: String?,
    @SerializedName("platform_style_hints") val platformStyleHints: Map<String, String>?
)

data class SyncMessagesRequest(
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, String>>
)

data class ConfigSaveResult(val success: Boolean, val message: String, val error: String?)

class ApiService(private val baseUrl: String) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(150, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun chat(request: ChatRequest): ChatResponse = withContext(Dispatchers.IO) {
        val json = gson.toJson(request)
        val body = json.toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(baseUrl + "/api/chat")
            .header("Authorization", "Bearer " + request.token)
            .post(body)
            .build()
        val response = client.newCall(req).execute()
        val responseBody = response.body?.string() ?: "{}"
        gson.fromJson(responseBody, ChatResponse::class.java)
    }

    suspend fun syncMessages(
        token: String,
        platform: String,
        contactId: String,
        contactName: String,
        messages: List<Map<String, String>>
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = SyncMessagesRequest(platform, contactId, contactName, messages)
            val json = gson.toJson(request)
            val body = json.toRequestBody(jsonMediaType)
            val req = Request.Builder()
                .url(baseUrl + "/api/messages/sync")
                .header("Authorization", "Bearer " + token)
                .post(body)
                .build()
            val response = client.newCall(req).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    suspend fun getConfig(token: String): ConfigResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(baseUrl + "/api/config")
            .header("Authorization", "Bearer " + token)
            .get()
            .build()
        val response = client.newCall(req).execute()
        val responseBody = response.body?.string() ?: "{}"
        gson.fromJson(responseBody, ConfigResponse::class.java)
    }

    suspend fun registerToken(token: String, name: String): Boolean = withContext(Dispatchers.IO) {
        val json = gson.toJson(mapOf("token" to token, "name" to name))
        val body = json.toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(baseUrl + "/api/token")
            .post(body)
            .build()
        val response = client.newCall(req).execute()
        response.isSuccessful
    }

    // 统一配置保存接口 POST /api/config/save
    suspend fun saveConfig(deviceKey: String, params: Map<String, String>): ConfigSaveResult = withContext(Dispatchers.IO) {
        try {
            val map = mutableMapOf("device_key" to deviceKey)
            map.putAll(params)
            val json = gson.toJson(map)
            val body = json.toRequestBody(jsonMediaType)
            val req = Request.Builder().url(baseUrl + "/api/config/save").post(body).build()
            val resp = client.newCall(req).execute()
            val respBody = resp.body?.string() ?: "{}"
            val result = gson.fromJson(respBody, Map::class.java)
            ConfigSaveResult(
                success = result?.get("success") as? Boolean ?: false,
                message = result?.get("message") as? String ?: "",
                error = result?.get("error") as? String
            )
        } catch (e: Exception) {
            ConfigSaveResult(success = false, message = "", error = e.message)
        }
    }

    suspend fun healthCheck(): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url(baseUrl + "/api/status")
                .get()
                .build()
            val response = client.newCall(req).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}
