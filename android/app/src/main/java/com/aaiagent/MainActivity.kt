package com.aaiagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.network.ApiService
import com.aaiagent.service.ForegroundService
import com.aaiagent.service.HostingController
import com.aaiagent.ui.screens.DashboardScreen
import com.aaiagent.ui.screens.ModelLineHealthState
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.screens.PersonaFactsUiState
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    internal lateinit var repository: AppRepository
    private var stateReceiver: BroadcastReceiver? = null
    internal var statePollJob: Job? = null

    // 核心状态
    internal var isHosting by mutableStateOf(false)
    internal var hostingMode by mutableStateOf(HostingMode.FULL_AUTO)
    internal var engineState by mutableStateOf("IDLE")
    internal var token by mutableStateOf("")
    internal var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    internal var enabledPlatforms by mutableStateOf(setOf("soul"))
    private var personas by mutableStateOf<List<PersonaItem>>(emptyList())
    private var activePersonaId by mutableStateOf("female")
    private var personaFacts by mutableStateOf(PersonaFactsUiState())
    internal var contactWhitelist by mutableStateOf<List<String>>(emptyList())
    internal var contactBlacklist by mutableStateOf<List<String>>(emptyList())

    // 验证状态
    private var personaVerifyStatus by mutableStateOf("")
    internal var tokenVerifyStatus by mutableStateOf("")
    internal var platformSyncStatus by mutableStateOf("")

    // 天气/时间感知
    internal var weatherEnabled by mutableStateOf(true)
    internal var timeEnabled by mutableStateOf(true)
    internal var lineA by mutableStateOf(true)
    internal var lineHealthA by mutableStateOf(ModelLineHealthState.UNKNOWN)
    internal var lineHealthB by mutableStateOf(ModelLineHealthState.UNKNOWN)
    internal var lineHealthMessage by mutableStateOf("")
    /** 语音回复总开关。默认关：没显式打开之前，文字回复行为一个字都不变。 */
    internal var voiceReplyEnabled by mutableStateOf(false)

    /** 配音送进录音的方式：auto / inject / speaker（见 VoiceOutputMode）。 */
    internal var voiceOutputMode by mutableStateOf(com.aaiagent.engine.VoiceOutputMode.AUTO)

    /**
     * 本机当前平台账号的昵称，手填（见 SelfNicknamePolicy）。
     *
     * 聊天页看不到自己的名字，昵称只出现在「我的」页面，而且每台设备、每个账号
     * 都不一样，自动去读容易读错，所以这里以手填为准。
     */
    internal var selfNickname by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Register broadcast receiver for ADB-triggered hosting toggle
        stateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    "com.aaiagent.TRIGGER_HOSTING" -> {
                        android.util.Log.d("AIA", "TRIGGER_HOSTING broadcast received")
                        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
                        if (engine?.hostingEnabled != true) toggleHosting(true)
                    }
                    HostingController.ACTION_HOSTING_STATE_CHANGED -> {
                        val enabled = intent.getBooleanExtra(HostingController.EXTRA_HOSTING_ENABLED, false)
                        isHosting = enabled
                        hostingMode = com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.hostingMode ?: hostingMode
                        if (enabled) {
                            com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.let(::startHostingPolling)
                        } else {
                            statePollJob?.cancel()
                        }
                    }
                }
            }
        }
        ContextCompat.registerReceiver(
            this,
            stateReceiver,
            IntentFilter().apply {
                addAction("com.aaiagent.TRIGGER_HOSTING")
                addAction(HostingController.ACTION_HOSTING_STATE_CHANGED)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)

        lifecycleScope.launch {
            hostingMode = withContext(Dispatchers.IO) {
                HostingSessionPolicy.hostingMode(repository.getConfig(HostingSessionPolicy.MODE_KEY))
            }
            val t = withContext(Dispatchers.IO) { repository.getActiveToken() }
            if (t != null) {
                token = t.token
                tokenVerifyStatus = "✓ 钥匙已保存"
            }
            val u = withContext(Dispatchers.IO) { repository.getConfig("api_base_url") }; if (u != null) apiBase = u
            if (token.isNotBlank()) {
                tokenVerifyStatus = "正在验证设备密钥..."
                val verify = ApiService(apiBase).saveConfig(token, mapOf("action" to "verify_token"))
                tokenVerifyStatus = if (verify.success) "✓ 设备密钥已验证" else "✗ 设备密钥无效或后端不可用"
            }
            enabledPlatforms = setOf(
                withContext(Dispatchers.IO) { repository.getConfig(HostingSessionPolicy.PLATFORM_KEY) }
                    ?.takeIf { it in setOf("soul", "qq", "douban", "lianxin") }
                    ?: "soul"
            )
            weatherEnabled = withContext(Dispatchers.IO) {
                repository.getConfig(HostingSessionPolicy.WEATHER_KEY) != "false"
            }
            timeEnabled = withContext(Dispatchers.IO) {
                repository.getConfig(HostingSessionPolicy.TIME_KEY) != "false"
            }
            lineA = withContext(Dispatchers.IO) {
                repository.getConfig(MODEL_LINE_KEY)?.trim()?.lowercase() != "b"
            }
            voiceReplyEnabled = withContext(Dispatchers.IO) {
                com.aaiagent.engine.VoiceReplyPolicy.isEnabled(
                    repository.getConfig(com.aaiagent.engine.VoiceReplyPolicy.ENABLED_KEY)
                )
            }
            voiceOutputMode = withContext(Dispatchers.IO) {
                repository.getConfig(com.aaiagent.engine.VoiceOutputMode.CONFIG_KEY)
                    ?.trim()
                    ?.lowercase()
                    ?.takeIf {
                        it == com.aaiagent.engine.VoiceOutputMode.INJECT ||
                            it == com.aaiagent.engine.VoiceOutputMode.SPEAKER
                    }
                    ?: com.aaiagent.engine.VoiceOutputMode.AUTO
            }
            selfNickname = withContext(Dispatchers.IO) {
                val platform = repository.getConfig(HostingSessionPolicy.PLATFORM_KEY)
                    ?.takeIf { it.isNotBlank() } ?: "soul"
                com.aaiagent.engine.SelfNicknamePolicy.forRequest(
                    repository.getConfig(
                        com.aaiagent.engine.SelfNicknamePolicy.configKey(platform)
                    )
                )
            }
            val loc = withContext(Dispatchers.IO) { repository.getLocation() }
            personaFacts = personaFacts.copy(
                currentCity = loc["home"]?.get("city") ?: "重庆",
                currentDistrict = loc["home"]?.get("district") ?: "两江新区",
                workCity = loc["work"]?.get("city") ?: "重庆",
                workDistrict = loc["work"]?.get("district") ?: "江北区",
            )
            contactWhitelist = withContext(Dispatchers.IO) { repository.getContactWhitelist() }
            contactBlacklist = withContext(Dispatchers.IO) { repository.getContactBlacklist() }
            try {
                loadPersonas()
                loadServerConfig()
            } catch (_: Exception) {}
        }

        // 检查引擎是否正在托管，提前设置状态（避免UI先显示灰色再变绿）
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        if (engine != null && engine.hostingEnabled) {
            isHosting = true
            hostingMode = engine.hostingMode
        }

        setContent {
            AaiagentTheme {
                DashboardScreen(
                    isHosting = isHosting, engineState = engineState,
                    enabledPlatforms = enabledPlatforms,
                    onTogglePlatform = { p, en ->
                        if (en) {
                            enabledPlatforms = setOf(p)
                            lifecycleScope.launch(Dispatchers.IO) {
                                repository.setConfig(HostingSessionPolicy.PLATFORM_KEY, p)
                            }
                        }
                    },
                    personas = personas, activePersonaId = activePersonaId,
                    onPersonaChange = { id -> activatePersona(id) },
                    token = token,
                    apiBase = apiBase,
                    onTokenChange = {
                        token = it.trim()
                        tokenVerifyStatus = ""
                        lineHealthA = ModelLineHealthState.UNKNOWN
                        lineHealthB = ModelLineHealthState.UNKNOWN
                        lineHealthMessage = ""
                    },
                    personaFacts = personaFacts,
                    hostingMode = hostingMode, onHostingModeChange = { selectHostingMode(it) },
                    onToggleHosting = { toggleHosting(it) },
                    personaVerifyStatus = personaVerifyStatus, onVerifyPersona = { verifyPersona() },
                    tokenVerifyStatus = tokenVerifyStatus, onVerifyToken = { verifyToken() },
                    platformSyncStatus = platformSyncStatus, onSyncPlatform = { syncPlatform(it) },
                    voiceReplyEnabled = voiceReplyEnabled, onVoiceReplyToggle = { toggleVoiceReply(it) },
                    voiceOutputMode = voiceOutputMode, onVoiceOutputChange = { changeVoiceOutputMode(it) },
                    selfNickname = selfNickname, onSelfNicknameChange = { changeSelfNickname(it) },
                    weatherEnabled = weatherEnabled, onWeatherToggle = { weatherEnabled = it; syncWeather() },
                    timeEnabled = timeEnabled, onTimeToggle = { timeEnabled = it; syncTime() },
                    lineA = lineA, onLineChange = { lineA = it; syncLine() },
                    lineHealthA = lineHealthA,
                    lineHealthB = lineHealthB,
                    lineHealthMessage = lineHealthMessage,
                    contactWhitelist = contactWhitelist, contactBlacklist = contactBlacklist,
                    onContactWhitelistChange = { updateContactWhitelist(it) },
                    onContactBlacklistChange = { updateContactBlacklist(it) }
                )
            }
        }
        ForegroundService.ensureRunning(this)
        requestPermissions()
    }

    private suspend fun loadPersonas() {
        try {
            val data = withContext(Dispatchers.IO) {
                okhttp3.OkHttpClient().newCall(okhttp3.Request.Builder().url("$apiBase/api/persona").get().build()).execute().body?.string() ?: "{}"
            }
            val list = com.google.gson.Gson().fromJson(data, Map::class.java)?.get("personas") as? List<*>
            if (list != null) {
                personas = list.mapNotNull {
                    val item = it as? Map<*, *> ?: return@mapNotNull null
                    PersonaItem(
                        id = item["id"] as? String ?: "",
                        name = item["name"] as? String ?: "",
                        systemPrompt = item["system_prompt"] as? String ?: "",
                        gender = item["gender"] as? String ?: "",
                        isActive = (item["is_active"] as? Number)?.toInt() == 1
                    )
                }
                val savedPersonaId = withContext(Dispatchers.IO) { repository.getPersonaId() }
                activePersonaId = personas.firstOrNull { it.isActive }?.id
                    ?: personas.firstOrNull { it.id == savedPersonaId }?.id
                    ?: personas.firstOrNull()?.id
                    ?: activePersonaId
                withContext(Dispatchers.IO) { repository.setConfig("persona_id", activePersonaId) }
            }
        } catch (_: Exception) {}
    }

    private suspend fun loadServerConfig() {
        if (token.isBlank()) return
        try {
            val config = ApiService(apiBase).getConfig(token)
            val serverPlatform = config.platform?.takeIf { it in setOf("soul", "qq", "douban", "lianxin") }
            if (serverPlatform != null) {
                enabledPlatforms = setOf(serverPlatform)
                withContext(Dispatchers.IO) { repository.setConfig(HostingSessionPolicy.PLATFORM_KEY, serverPlatform) }
            }
            config.weatherEnabled?.let {
                weatherEnabled = it
                withContext(Dispatchers.IO) { repository.setConfig(HostingSessionPolicy.WEATHER_KEY, it.toString()) }
            }
            config.timeEnabled?.let {
                timeEnabled = it
                withContext(Dispatchers.IO) { repository.setConfig(HostingSessionPolicy.TIME_KEY, it.toString()) }
            }
            config.line?.let {
                lineA = it.trim().lowercase() != "b"
                withContext(Dispatchers.IO) {
                    repository.setConfig(MODEL_LINE_KEY, if (lineA) "a" else "b")
                }
                checkSelectedLineHealth()
            }
            config.replyPaceSec?.let {
                com.aaiagent.engine.ReplyPaceGate.paceSec = it.coerceIn(0, 300)
            }
            val serverPersonaId = config.activePersonaId?.takeIf { it.isNotBlank() }
            if (serverPersonaId != null && personas.any { it.id == serverPersonaId }) {
                activePersonaId = serverPersonaId
                personas = personas.map { it.copy(isActive = it.id == serverPersonaId) }
                withContext(Dispatchers.IO) { repository.setConfig("persona_id", serverPersonaId) }
            }
            val home = config.location?.home
            val work = config.location?.work
            val serverHomeCity = home?.city?.takeIf { it.isNotBlank() }
            val serverHomeDistrict = home?.district?.takeIf { it.isNotBlank() }
            val serverWorkCity = work?.city?.takeIf { it.isNotBlank() }
            val serverWorkDistrict = work?.district?.takeIf { it.isNotBlank() }
            val serverFacts = config.personaFacts
            personaFacts = personaFacts.copy(
                ageMode = serverFacts?.ageMode ?: personaFacts.ageMode,
                fixedAge = serverFacts?.fixedAge?.toString() ?: personaFacts.fixedAge,
                birthYear = serverFacts?.birthYear?.toString() ?: personaFacts.birthYear,
                maritalStatus = serverFacts?.maritalStatus ?: personaFacts.maritalStatus,
                hasChildren = serverFacts?.hasChildren ?: personaFacts.hasChildren,
                childrenAge = serverFacts?.childrenAge?.toString() ?: personaFacts.childrenAge,
                contactQq = serverFacts?.contactQq ?: personaFacts.contactQq,
                hometown = serverFacts?.hometown ?: personaFacts.hometown,
                currentCity = serverFacts?.currentCity ?: serverHomeCity ?: personaFacts.currentCity,
                currentDistrict = serverFacts?.currentDistrict ?: serverHomeDistrict ?: personaFacts.currentDistrict,
                commonArea = serverFacts?.commonArea ?: personaFacts.commonArea,
                workCity = serverFacts?.workCity ?: serverWorkCity ?: personaFacts.workCity,
                workDistrict = serverFacts?.workDistrict ?: serverWorkDistrict ?: personaFacts.workDistrict,
                locationPrecision = serverFacts?.locationPrecision ?: personaFacts.locationPrecision,
                proactiveLocationAllowed = serverFacts?.proactiveLocationAllowed ?: personaFacts.proactiveLocationAllowed,
                configVersion = serverFacts?.configVersion ?: personaFacts.configVersion,
            )
            withContext(Dispatchers.IO) {
                repository.setLocation(
                    personaFacts.currentCity,
                    personaFacts.currentDistrict,
                    personaFacts.workCity,
                    personaFacts.workDistrict,
                )
            }
        } catch (_: Exception) {}
    }

    // ═══ 验证函数 ═══

    private fun verifyToken() {
        val candidate = token.trim()
        if (candidate.isEmpty()) {
            tokenVerifyStatus = "✗ 请先输入设备钥匙"
            return
        }
        token = candidate
        tokenVerifyStatus = "验证中..."
        lifecycleScope.launch {
            try {
                val r = ApiService(apiBase).saveConfig(candidate, mapOf("action" to "verify_token"))
                if (r.success) {
                    withContext(Dispatchers.IO) { repository.activateVerifiedToken(candidate) }
                    tokenVerifyStatus = "✓ 钥匙有效，已保存"
                    loadServerConfig()
                } else {
                    tokenVerifyStatus = "✗ ${r.error ?: "钥匙无效"}"
                }
            } catch (_: Exception) {
                tokenVerifyStatus = "✗ 验证失败"
            }
        }
    }

    private fun activatePersona(id: String) {
        if (token.isBlank()) {
            personaVerifyStatus = "✗ 请先验证设备钥匙"
            return
        }
        val previous = activePersonaId
        activePersonaId = id
        personas = personas.map { it.copy(isActive = it.id == id) }
        personaVerifyStatus = "切换中..."
        lifecycleScope.launch {
            try {
                val result = ApiService(apiBase).saveConfig(
                    token,
                    mapOf("action" to "activate_persona", "persona_id" to id)
                )
                if (result.success) {
                    withContext(Dispatchers.IO) { repository.setConfig("persona_id", id) }
                    personaVerifyStatus = "✓ 已切换"
                    loadServerConfig()
                } else {
                    activePersonaId = previous
                    personas = personas.map { it.copy(isActive = it.id == previous) }
                    personaVerifyStatus = "✗ ${result.error ?: "切换失败"}"
                }
            } catch (_: Exception) {
                activePersonaId = previous
                personas = personas.map { it.copy(isActive = it.id == previous) }
                personaVerifyStatus = "✗ 切换失败"
            }
        }
    }

    private fun verifyPersona() {
        activatePersona(activePersonaId)
    }

    override fun onResume() {
        super.onResume()
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        isHosting = engine?.hostingEnabled == true
        if (isHosting) {
            hostingMode = engine?.hostingMode ?: hostingMode
        } else {
        }
        resumeRequestedHosting()
        ForegroundService.ensureRunning(this)
    }

    override fun onDestroy() {
        stateReceiver?.let { unregisterReceiver(it) }
        stateReceiver = null
        super.onDestroy()
    }

    internal companion object {
        const val MODEL_LINE_KEY = "model_line"
    }
}
