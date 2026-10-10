package com.aaiagent.network

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

data class ChatRequest(
    val token: String,
    val platform: String,
    @SerializedName("hosting_mode") val hostingMode: String,
    @SerializedName("request_id") val requestId: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, Any>>,
    @SerializedName("conversation_timeline") val conversationTimeline: String? = null,
    @SerializedName("conversation_stage") val conversationStage: String = "unknown",
    @SerializedName("relationship_origin") val relationshipOrigin: String = "unknown",
    /** 本机当前平台账号昵称，用户手填；空串表示没填（见 SelfNicknamePolicy）。 */
    @SerializedName("self_nickname") val selfNickname: String = "",
    val location: Map<String, Map<String, String>>? = null
)

data class ChatResponse(
    val action: String?,
    val reply: String?,
    val media: ChatMedia?,
    @SerializedName("reply_id") val replyId: String?,
    val error: String?,
    val code: String? = null,
    @SerializedName("request_id") val requestId: String? = null,
    @SerializedName("cooldown_ms") val cooldownMs: Long? = null,
    @SerializedName("self_leave_ms") val selfLeaveMs: Long? = null,
    val reason: String? = null,
    val timing: ChatTiming? = null,
    @SerializedName("persona_id") val personaId: String? = null,
    @SerializedName("persona_version") val personaVersion: Int? = null,
    @SerializedName("model_line") val modelLine: String? = null,
    @SerializedName("model_name") val modelName: String? = null,
    @SerializedName("reply_audit") val replyAudit: ReplyAudit? = null
)

data class ReplyAudit(
    val source: String? = null,
    val reason: String? = null,
    val overrides: List<ReplyAuditOverride> = emptyList()
)

data class ReplyAuditOverride(
    val rule: String? = null,
    val reason: String? = null,
    val before: String? = null,
    val after: String? = null
)

data class ChatTiming(
    @SerializedName("persona_ms") val personaMs: Long? = null,
    @SerializedName("context_ms") val contextMs: Long? = null,
    @SerializedName("llm_ms") val llmMs: Long? = null,
    @SerializedName("main_llm_ms") val mainLlmMs: Long? = null,
    @SerializedName("repair_ms") val repairMs: Long? = null,
    @SerializedName("total_ms") val totalMs: Long? = null,
    @SerializedName("repair_attempted") val repairAttempted: Boolean? = null,
    @SerializedName("repair_timeout") val repairTimeout: Boolean? = null,
    @SerializedName("llm_budget_ms") val llmBudgetMs: Long? = null
)

data class NetworkTiming(
    val dnsMs: Long? = null,
    val connectMs: Long? = null,
    val tlsMs: Long? = null,
    val requestMs: Long? = null,
    val ttfbMs: Long? = null,
    val responseBodyMs: Long? = null,
    val totalMs: Long? = null
)

data class ChatCallResult(
    val response: ChatResponse,
    val networkTiming: NetworkTiming
)

data class ExchangeMediaRequest(
    val token: String,
    val platform: String,
    @SerializedName("hosting_mode") val hostingMode: String,
    @SerializedName("request_id") val requestId: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String
)

data class ChatMedia(
    val type: String?,
    @SerializedName("asset_id") val assetId: String?,
    @SerializedName("group_id") val groupId: String?,
    @SerializedName("download_url") val downloadUrl: String?,
    @SerializedName("content_type") val contentType: String?,
    @SerializedName("file_name") val fileName: String?
)

data class ConfigResponse(
    @SerializedName("active_persona_id") val activePersonaId: String?,
    @SerializedName("active_persona_name") val activePersonaName: String?,
    val location: ConfigLocation? = null,
    @SerializedName("persona_facts") val personaFacts: ConfigPersonaFacts? = null,
    val platform: String? = null,
    @SerializedName("hosting_enabled") val hostingEnabled: Boolean? = null,
    @SerializedName("monitor_enabled") val monitorEnabled: Boolean? = null,
    @SerializedName("weather_enabled") val weatherEnabled: Boolean? = null,
    @SerializedName("time_enabled") val timeEnabled: Boolean? = null,
    @SerializedName("reply_pace_sec") val replyPaceSec: Int? = null,
    @SerializedName("ai_hours_enabled") val aiHoursEnabled: Boolean? = null,
    @SerializedName("ai_start_hour") val aiStartHour: Int? = null,
    @SerializedName("ai_end_hour") val aiEndHour: Int? = null,
    val line: String? = null
)

data class ModelRouteHealthResponse(
    val ok: Boolean = false,
    val line: String? = null,
    val provider: String? = null,
    val error: String? = null,
    @SerializedName("latency_ms") val latencyMs: Long? = null,
    @SerializedName("upstream_status") val upstreamStatus: Int? = null
)

data class ConfigPersonaFacts(
    @SerializedName("age_mode") val ageMode: String? = null,
    @SerializedName("fixed_age") val fixedAge: Int? = null,
    @SerializedName("birth_year") val birthYear: Int? = null,
    val age: Int? = null,
    @SerializedName("marital_status") val maritalStatus: String? = null,
    @SerializedName("has_children") val hasChildren: Boolean? = null,
    @SerializedName("children_age") val childrenAge: Int? = null,
    val hometown: String? = null,
    @SerializedName("current_city") val currentCity: String? = null,
    @SerializedName("current_district") val currentDistrict: String? = null,
    @SerializedName("common_area") val commonArea: String? = null,
    @SerializedName("work_city") val workCity: String? = null,
    @SerializedName("work_district") val workDistrict: String? = null,
    @SerializedName("location_precision") val locationPrecision: String? = null,
    @SerializedName("proactive_location_allowed") val proactiveLocationAllowed: Boolean? = null,
    @SerializedName("contact_qq") val contactQq: String? = null,
    @SerializedName("config_version") val configVersion: Long? = null
)

data class ConfigLocation(
    val home: ConfigAddress? = null,
    val work: ConfigAddress? = null
)

data class ConfigAddress(
    val city: String? = null,
    val district: String? = null
)

data class SyncMessagesRequest(
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, Any>>
)

data class ConfigSaveResult(
    val success: Boolean,
    val message: String,
    val error: String?,
    @SerializedName("config_version") val configVersion: Long? = null,
    @SerializedName("persona_facts") val personaFacts: ConfigPersonaFacts? = null
)

data class ConfirmChatRequest(
    @SerializedName("reply_id") val replyId: String,
    @SerializedName("sent_content") val sentContent: String
)

data class ConfirmChatResponse(
    val success: Boolean?,
    val status: String?,
    val error: String?
)

data class VisionResponse(
    val success: Boolean,
    val description: String?,
    val error: String?
)

data class ReplyTask(
    val type: String,
    @SerializedName("task_id") val taskId: String?,
    @SerializedName("group_id") val groupId: String?,
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val content: String?
)

data class ReplyTaskResponse(val task: ReplyTask?)

data class FishAudioCapabilitiesResponse(
    val provider: String?,
    val configured: Boolean?,
    val models: FishAudioModels?,
    val features: Map<String, Boolean>?,
    val error: String?
)

data class FishAudioModels(
    val tts: String?,
    val asr: String?,
    @SerializedName("voice_design") val voiceDesign: String?
)

data class SpeechSynthesisResult(
    val contentType: String?,
    val audio: ByteArray
)

/**
 * 情绪表演层的结果。
 *
 * [taggedText] 是可以直接发给 Fish 的文本（可能带官方情绪标签）；
 * [state] 是更新后的情绪状态，下一轮原样传回去，情绪才连得起来。
 */
data class VoicePerformanceResponse(
    @SerializedName("tagged_text") val taggedText: String?,
    val state: String?,
    @SerializedName("dominant_emotion") val dominantEmotion: String?,
    val planned: Boolean,
    val reason: String?
)

data class SpeechTranscriptionResponse(
    val text: String?,
    val duration: Double?,
    val segments: List<SpeechTranscriptionSegment>?,
    @SerializedName("language_code") val languageCode: String?,
    val language: String?
)

data class SpeechTranscriptionSegment(
    val text: String?,
    val start: Double?,
    val end: Double?
)

class ApiHttpException(
    val statusCode: Int,
    val responseBody: String
) : IllegalStateException("HTTP $statusCode: ${responseBody.take(300)}")

private class NetworkTimingEventListener : EventListener() {
    private var callStartedAtNanos = 0L
    private var dnsStartedAtNanos = 0L
    private var dnsEndedAtNanos = 0L
    private var connectStartedAtNanos = 0L
    private var connectEndedAtNanos = 0L
    private var secureConnectStartedAtNanos = 0L
    private var secureConnectEndedAtNanos = 0L
    private var requestEndedAtNanos = 0L
    private var responseHeadersStartedAtNanos = 0L
    private var responseHeadersEndedAtNanos = 0L
    private var callEndedAtNanos = 0L

    override fun callStart(call: Call) {
        callStartedAtNanos = System.nanoTime()
    }

    override fun dnsStart(call: Call, domainName: String) {
        dnsStartedAtNanos = System.nanoTime()
    }

    override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
        dnsEndedAtNanos = System.nanoTime()
    }

    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
        connectStartedAtNanos = System.nanoTime()
    }

    override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: okhttp3.Protocol?) {
        connectEndedAtNanos = System.nanoTime()
    }

    override fun secureConnectStart(call: Call) {
        secureConnectStartedAtNanos = System.nanoTime()
    }

    override fun secureConnectEnd(call: Call, handshake: okhttp3.Handshake?) {
        secureConnectEndedAtNanos = System.nanoTime()
    }

    override fun requestHeadersEnd(call: Call, request: Request) {
        requestEndedAtNanos = System.nanoTime()
    }

    override fun requestBodyEnd(call: Call, byteCount: Long) {
        requestEndedAtNanos = System.nanoTime()
    }

    override fun responseHeadersStart(call: Call) {
        responseHeadersStartedAtNanos = System.nanoTime()
    }

    override fun responseHeadersEnd(call: Call, response: Response) {
        responseHeadersEndedAtNanos = System.nanoTime()
    }

    override fun callEnd(call: Call) {
        callEndedAtNanos = System.nanoTime()
    }

    override fun callFailed(call: Call, ioe: IOException) {
        callEndedAtNanos = System.nanoTime()
    }

    fun snapshot(): NetworkTiming {
        val endedAtNanos = callEndedAtNanos.takeIf { it > 0L } ?: System.nanoTime()
        return NetworkTiming(
            dnsMs = elapsedMillis(dnsStartedAtNanos, dnsEndedAtNanos),
            connectMs = elapsedMillis(connectStartedAtNanos, connectEndedAtNanos),
            tlsMs = elapsedMillis(secureConnectStartedAtNanos, secureConnectEndedAtNanos),
            requestMs = elapsedMillis(callStartedAtNanos, requestEndedAtNanos),
            ttfbMs = elapsedMillis(requestEndedAtNanos, responseHeadersStartedAtNanos),
            responseBodyMs = elapsedMillis(responseHeadersEndedAtNanos, endedAtNanos),
            totalMs = elapsedMillis(callStartedAtNanos, endedAtNanos)
        )
    }

    private fun elapsedMillis(startedAtNanos: Long, endedAtNanos: Long): Long? {
        if (startedAtNanos <= 0L || endedAtNanos <= 0L || endedAtNanos < startedAtNanos) return null
        return TimeUnit.NANOSECONDS.toMillis(endedAtNanos - startedAtNanos)
    }
}

object ApiTimeoutPolicy {
    const val SHORT_CONNECT_TIMEOUT_SECONDS = 10L
    const val SHORT_READ_TIMEOUT_SECONDS = 15L
    const val SHORT_WRITE_TIMEOUT_SECONDS = 10L
    const val SHORT_CALL_TIMEOUT_SECONDS = 20L
    const val MODEL_READ_TIMEOUT_SECONDS = 10L
    const val MODEL_CALL_TIMEOUT_SECONDS = 12L
}

class ApiService internal constructor(
    private val baseUrl: String,
    private val modelReadTimeoutMs: Long = TimeUnit.SECONDS.toMillis(ApiTimeoutPolicy.MODEL_READ_TIMEOUT_SECONDS),
    private val modelCallTimeoutMs: Long = TimeUnit.SECONDS.toMillis(ApiTimeoutPolicy.MODEL_CALL_TIMEOUT_SECONDS)
) {
    // 三个客户端都从同一个基座派生，共用它的连接池。
    // 以前每次 new ApiService 都会新建一个空池，于是每个请求都重新握手。
    private val shortClient = SHARED_HTTP_CLIENT
    private val modelClient = SHARED_HTTP_CLIENT.newBuilder()
        .readTimeout(modelReadTimeoutMs, TimeUnit.MILLISECONDS)
        .callTimeout(modelCallTimeoutMs, TimeUnit.MILLISECONDS)
        .build()
    // Voice work runs inside the hosting loop, so an unreachable upstream used
    // to freeze every other conversation for up to two minutes.
    private val voiceClient = SHARED_HTTP_CLIENT.newBuilder()
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(75, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()

    private companion object {
        const val MAX_MEDIA_BYTES = 12L * 1024L * 1024L

        /**
         * 进程内共用一个 OkHttpClient。
         *
         * OkHttpClient 自己持有连接池和线程池，每 new 一个就是一个空池。
         * 真机实测（2026-10-07）：MessageEngine 每次调用都新建 ApiService，
         * 于是每个请求都要重新做 TCP + TLS 握手 —— connect/tls 实测 0.9~3.4 秒，
         * 而服务端本身只花 2.1~3.4 秒。共用之后这些握手只剩第一次。
         *
         * 注意：用 newBuilder() 派生的客户端**共享同一个连接池**，所以
         * modelClient / voiceClient 各自改超时不会把连接池拆开。
         */
        private val SHARED_HTTP_CLIENT: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(ApiTimeoutPolicy.SHORT_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .readTimeout(ApiTimeoutPolicy.SHORT_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .writeTimeout(ApiTimeoutPolicy.SHORT_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .callTimeout(ApiTimeoutPolicy.SHORT_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .build()
        }
    }
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun chat(request: ChatRequest): ChatCallResult = withContext(Dispatchers.IO) {
        val json = gson.toJson(request)
        val body = json.toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(baseUrl + "/api/chat")
            .header("Authorization", "Bearer " + request.token)
            .post(body)
            .build()
        val timingListener = NetworkTimingEventListener()
        val timingClient = modelClient.newBuilder()
            .eventListener(timingListener)
            .build()
        val chatResponse = timingClient.newCall(req).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            val parsed = gson.fromJson(responseBody, ChatResponse::class.java)
            if (!response.isSuccessful && parsed?.error.isNullOrBlank()) {
                throw ApiHttpException(response.code, responseBody)
            }
            parsed ?: throw IllegalStateException("deepseek_empty_response")
        }
        ChatCallResult(chatResponse, timingListener.snapshot())
    }

    suspend fun selectExchangeMedia(request: ExchangeMediaRequest): ChatResponse = withContext(Dispatchers.IO) {
        val body = gson.toJson(request).toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/media/exchange")
            .header("Authorization", "Bearer " + request.token)
            .post(body)
            .build()
        shortClient.newCall(req).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw ApiHttpException(response.code, responseBody)
            gson.fromJson(responseBody, ChatResponse::class.java)
                ?: throw IllegalStateException("exchange_media_empty_response")
        }
    }

    suspend fun downloadMedia(token: String, media: ChatMedia): ByteArray = withContext(Dispatchers.IO) {
        val assetId = media.assetId.orEmpty().trim()
        val path = media.downloadUrl.orEmpty().trim()
        if (media.type != "image" || assetId.isBlank() || path.isBlank()) {
            throw IllegalArgumentException("invalid_media")
        }
        val url = if (path.startsWith("https://") || path.startsWith("http://")) {
            path
        } else {
            baseUrl.trimEnd('/') + "/" + path.trimStart('/')
        }
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer " + token)
            .get()
            .build()
        shortClient.newCall(request).execute().use { response ->
            val responseBody = response.body ?: throw IllegalStateException("media_empty_response")
            if (!response.isSuccessful) {
                throw ApiHttpException(response.code, responseBody.string().take(300))
            }
            val declaredLength = responseBody.contentLength()
            if (declaredLength > MAX_MEDIA_BYTES) throw IllegalStateException("media_too_large")
            val contentType = responseBody.contentType()?.type?.lowercase()
            if (contentType != null && contentType != "image") throw IllegalStateException("media_not_image")
            val bytes = responseBody.bytes()
            if (bytes.isEmpty()) throw IllegalStateException("media_empty_response")
            if (bytes.size > MAX_MEDIA_BYTES) throw IllegalStateException("media_too_large")
            bytes
        }
    }

    suspend fun confirmChatReply(token: String, replyId: String, sentContent: String): Boolean = withContext(Dispatchers.IO) {
        if (replyId.isBlank()) return@withContext false
        try {
            val payload = ConfirmChatRequest(replyId = replyId, sentContent = sentContent)
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/chat/confirm")
                .header("Authorization", "Bearer " + token)
                .post(body)
                .build()
            shortClient.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) return@withContext false
                gson.fromJson(responseBody, ConfirmChatResponse::class.java)?.success == true
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun syncMessages(
        token: String,
        platform: String,
        contactId: String,
        contactName: String,
        messages: List<Map<String, Any>>
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
            val response = shortClient.newCall(req).execute()
            response.use { it.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun uploadAutomationIncident(
        token: String,
        incidentFile: File,
        source: String = "android",
        kind: String = "manual_feedback",
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            if (!incidentFile.exists() || incidentFile.length() > 16L * 1024L * 1024L) {
                return@withContext false
            }
            val incidentId = incidentFile.name
                .removePrefix("incident-")
                .removeSuffix(".jsonl")
            val payload = incidentFile.readText()
            if (payload.isBlank()) return@withContext false
            val body = payload.toRequestBody("application/x-ndjson; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/automation-incidents")
                .header("Authorization", "Bearer " + token)
                .header("X-Incident-Id", incidentId)
                .header("X-Incident-Source", source)
                .header("X-Incident-Kind", kind)
                .post(body)
                .build()
            voiceClient.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (_: Exception) {
            false
        }
    }

    suspend fun getConfig(token: String): ConfigResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(baseUrl + "/api/config")
            .header("Authorization", "Bearer " + token)
            .get()
            .build()
        val response = shortClient.newCall(req).execute()
        response.use {
            val responseBody = it.body?.string() ?: "{}"
            if (!it.isSuccessful) throw ApiHttpException(it.code, responseBody)
            gson.fromJson(responseBody, ConfigResponse::class.java)
                ?: throw IllegalStateException("config_empty_response")
        }
    }

    suspend fun checkModelRouteHealth(token: String, line: String): ModelRouteHealthResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/model-route/health?line=" + line.trim().lowercase())
                .header("Authorization", "Bearer " + token)
                .get()
                .build()
            modelClient.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                val parsed = gson.fromJson(responseBody, ModelRouteHealthResponse::class.java)
                if (parsed != null) {
                    parsed
                } else {
                    ModelRouteHealthResponse(
                        ok = false,
                        line = line,
                        error = if (response.isSuccessful) "线路检测返回为空" else "HTTP ${response.code}"
                    )
                }
            }
        }

    suspend fun getFishAudioCapabilities(token: String): FishAudioCapabilitiesResponse =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/voice/capabilities")
                .header("Authorization", "Bearer " + token)
                .get()
                .build()
            shortClient.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiHttpException(response.code, responseBody)
                }
                gson.fromJson(responseBody, FishAudioCapabilitiesResponse::class.java)
                    ?: throw IllegalStateException("fish_audio_capabilities_empty_response")
            }
        }

    suspend fun synthesizeSpeech(
        token: String,
        text: String,
        referenceId: String? = null,
        model: String? = null,
        format: String? = null
    ): SpeechSynthesisResult = withContext(Dispatchers.IO) {
        val normalizedText = FishAudioRequestPolicy.requireSpeechText(text)
        val payload = mutableMapOf<String, Any>(
            "text" to normalizedText,
            "model" to FishAudioRequestPolicy.resolveTtsModel(model),
            "format" to FishAudioRequestPolicy.resolveFormat(format)
        )
        referenceId?.trim()?.takeIf { it.isNotEmpty() }?.let { payload["reference_id"] = it }
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/voice/tts")
            .header("Authorization", "Bearer " + token)
            .post(gson.toJson(payload).toRequestBody(jsonMediaType))
            .build()
        voiceClient.newCall(request).execute().use { response ->
            val responseBody = response.body ?: throw IllegalStateException("speech_empty_response")
            if (!response.isSuccessful) {
                throw ApiHttpException(response.code, responseBody.string().take(500))
            }
            val bytes = responseBody.bytes()
            FishAudioRequestPolicy.requireSpeechResult(bytes)
            SpeechSynthesisResult(
                contentType = responseBody.contentType()?.toString(),
                audio = bytes
            )
        }
    }

    /**
     * 情绪表演层：把一条**已经定稿**的回复变成"带官方情绪标签的 TTS 文本"。
     *
     * 单独一个接口 —— 不打算发语音时根本不会调它；调不通就原样用回复文字，
     * 也就是这条语音没有情绪而已，绝不会影响回复内容本身。
     */
    suspend fun voicePerformance(
        token: String,
        replyText: String,
        contextLines: List<String> = emptyList(),
        previousState: String? = null
    ): VoicePerformanceResponse = withContext(Dispatchers.IO) {
        val payload = mutableMapOf<String, Any>("reply_text" to replyText)
        if (contextLines.isNotEmpty()) payload["context"] = contextLines
        previousState?.trim()?.takeIf { it.isNotEmpty() }?.let {
            payload["previous_state"] = it
        }
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/voice/performance")
            .header("Authorization", "Bearer " + token)
            .post(gson.toJson(payload).toRequestBody(jsonMediaType))
            .build()
        voiceClient.newCall(request).execute().use { response ->
            val responseBody = response.body
                ?: throw IllegalStateException("performance_empty_response")
            if (!response.isSuccessful) {
                throw ApiHttpException(response.code, responseBody.string().take(500))
            }
            gson.fromJson(responseBody.string(), VoicePerformanceResponse::class.java)
                ?: throw IllegalStateException("performance_empty_body")
        }
    }

    suspend fun transcribeAudio(
        token: String,
        audio: ByteArray,
        fileName: String = "audio.wav",
        mimeType: String = "audio/wav",
        language: String? = null,
        model: String? = null,
        includeTimestamps: Boolean = true
    ): SpeechTranscriptionResponse = withContext(Dispatchers.IO) {
        FishAudioRequestPolicy.requireAudio(audio)
        val builder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "audio",
                fileName.ifBlank { "audio.wav" },
                audio.toRequestBody(mimeType.toMediaType())
            )
            .addFormDataPart("model", FishAudioRequestPolicy.resolveAsrModel(model))
            .addFormDataPart("ignore_timestamps", (!includeTimestamps).toString())
        language?.trim()?.takeIf { it.isNotEmpty() }?.let {
            builder.addFormDataPart("language", it)
        }
        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/voice/asr")
            .header("Authorization", "Bearer " + token)
            .post(builder.build())
            .build()
        voiceClient.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiHttpException(response.code, responseBody)
            }
            gson.fromJson(responseBody, SpeechTranscriptionResponse::class.java)
                ?: throw IllegalStateException("speech_transcription_empty_response")
        }
    }

    suspend fun registerToken(token: String, name: String): Boolean = withContext(Dispatchers.IO) {
        val json = gson.toJson(mapOf("token" to token, "name" to name))
        val body = json.toRequestBody(jsonMediaType)
        val req = Request.Builder()
            .url(baseUrl + "/api/token")
            .post(body)
            .build()
        val response = shortClient.newCall(req).execute()
        response.use { it.isSuccessful }
    }


    // 自注册联系人（调用后 chat API 才不会 skip）
    suspend fun registerContact(token: String, platform: String, contactId: String, contactName: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val map = mapOf("token" to token, "platform" to platform, "contact_id" to contactId, "contact_name" to contactName)
            val json = gson.toJson(map)
            val body = json.toRequestBody(jsonMediaType)
            val req = Request.Builder()
                .url(baseUrl + "/api/contacts")
                .post(body)
                .build()
            val response = shortClient.newCall(req).execute()
            response.use { it.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    // 缁熶竴閰嶇疆淇濆瓨鎺ュ彛 POST /api/config/save
    suspend fun describeVision(
        token: String,
        imageBase64: String,
        mimeType: String = "image/jpeg",
        prompt: String
    ): VisionResponse = withContext(Dispatchers.IO) {
        try {
            val payload = mapOf(
                "token" to token,
                "image_base64" to imageBase64,
                "mime_type" to mimeType,
                "prompt" to prompt
            )
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/vision/describe")
                .header("Authorization", "Bearer " + token)
                .post(body)
                .build()
            val response = modelClient.newCall(request).execute()
            val responseBody = response.body?.string() ?: "{}"
            val map = gson.fromJson(responseBody, Map::class.java)
            VisionResponse(
                success = map?.get("success") as? Boolean ?: false,
                description = map?.get("description") as? String,
                error = map?.get("error") as? String
            )
        } catch (e: Exception) {
            VisionResponse(false, null, e.message ?: "vision request failed")
        }
    }

    suspend fun saveConfig(deviceKey: String, params: Map<String, String>): ConfigSaveResult = withContext(Dispatchers.IO) {
        try {
            val map = mutableMapOf("device_key" to deviceKey)
            map.putAll(params)
            val json = gson.toJson(map)
            val body = json.toRequestBody(jsonMediaType)
            val req = Request.Builder().url(baseUrl + "/api/config/save").post(body).build()
            val resp = shortClient.newCall(req).execute()
            val respBody = resp.body?.string() ?: "{}"
            gson.fromJson(respBody, ConfigSaveResult::class.java)
                ?: ConfigSaveResult(success = false, message = "", error = "empty_response")
        } catch (e: Exception) {
            ConfigSaveResult(success = false, message = "", error = e.message)
        }
    }

    suspend fun getNextReplyTask(
        token: String,
        platform: String
    ): ReplyTask? = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/api/reply-tasks/next?platform=" + platform)
            .header("Authorization", "Bearer " + token)
            .get()
            .build()
        shortClient.newCall(req).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw ApiHttpException(response.code, responseBody)
            gson.fromJson(responseBody, ReplyTaskResponse::class.java)?.task
        }
    }

    suspend fun reportReplyTask(
        token: String,
        taskId: String,
        status: String,
        error: String = ""
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val payload = mapOf(
                "task_id" to taskId,
                "status" to status,
                "error" to error
            )
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val req = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/api/reply-tasks/result")
                .header("Authorization", "Bearer " + token)
                .post(body)
                .build()
            shortClient.newCall(req).execute().use { response -> response.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    suspend fun healthCheck(): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url(baseUrl + "/api/status")
                .get()
                .build()
            val response = shortClient.newCall(req).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}
