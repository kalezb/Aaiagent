package com.aaiagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.ContactListCodec
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

    private lateinit var repository: AppRepository
    private var stateReceiver: BroadcastReceiver? = null
    private var statePollJob: Job? = null

    // 核心状态
    private var isHosting by mutableStateOf(false)
    private var hostingMode by mutableStateOf(HostingMode.FULL_AUTO)
    private var engineState by mutableStateOf("IDLE")
    private var token by mutableStateOf("")
    private var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    private var enabledPlatforms by mutableStateOf(setOf("soul"))
    private var personas by mutableStateOf<List<PersonaItem>>(emptyList())
    private var activePersonaId by mutableStateOf("female")
    private var personaFacts by mutableStateOf(PersonaFactsUiState())
    private var contactWhitelist by mutableStateOf<List<String>>(emptyList())
    private var contactBlacklist by mutableStateOf<List<String>>(emptyList())

    // 验证状态
    private var personaVerifyStatus by mutableStateOf("")
    private var tokenVerifyStatus by mutableStateOf("")
    private var platformSyncStatus by mutableStateOf("")
    private var voiceTestStatus by mutableStateOf("")

    // 天气/时间感知
    private var weatherEnabled by mutableStateOf(true)
    private var timeEnabled by mutableStateOf(true)
    private var lineA by mutableStateOf(true)
    private var lineHealthA by mutableStateOf(ModelLineHealthState.UNKNOWN)
    private var lineHealthB by mutableStateOf(ModelLineHealthState.UNKNOWN)
    private var lineHealthMessage by mutableStateOf("")
    /** 语音回复总开关。默认关：没显式打开之前，文字回复行为一个字都不变。 */
    private var voiceReplyEnabled by mutableStateOf(false)

    /** 配音送进录音的方式：auto / inject / speaker（见 VoiceOutputMode）。 */
    private var voiceOutputMode by mutableStateOf(com.aaiagent.engine.VoiceOutputMode.AUTO)

    /**
     * 本机当前平台账号的昵称，手填（见 SelfNicknamePolicy）。
     *
     * 聊天页看不到自己的名字，昵称只出现在「我的」页面，而且每台设备、每个账号
     * 都不一样，自动去读容易读错，所以这里以手填为准。
     */
    private var selfNickname by mutableStateOf("")

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
                    voiceTestStatus = voiceTestStatus, onVoiceTest = { runVoiceTest() },
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

    /**
     * 语音回复总开关。**默认关**；打开之后，回复才会以语音发出去
     * （而且只有 VoiceReplyPolicy 判定够短、且联系人在名单里时才会走语音）。
     */
    private fun toggleVoiceReply(enabled: Boolean) {
        voiceReplyEnabled = enabled
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(
                com.aaiagent.engine.VoiceReplyPolicy.ENABLED_KEY,
                enabled.toString()
            )
        }
        android.util.Log.d("AIA", "voice reply toggled enabled=$enabled")
    }

    /**
     * 配音方式：自动 / 注入 / 外放。
     *
     * 自动是默认 —— 能注入就注入（音质干净，需 root），否则用扬声器放出来录（不需 root）。
     * 手动锁定主要是为了在同一台手机上对比两种效果。
     */
    private fun changeVoiceOutputMode(mode: String) {
        voiceOutputMode = mode
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(com.aaiagent.engine.VoiceOutputMode.CONFIG_KEY, mode)
        }
        android.util.Log.d("AIA", "voice output mode changed to $mode")
    }

    /**
     * 本机当前平台账号昵称，手填（见 SelfNicknamePolicy）。
     *
     * 界面上保留你正在打的原文，存进配置表的是清洗后的值（去换行、限长），
     * 这样边打边存也不会跟你抢输入。清空就是"不填"，后端不会注入昵称那段提示词。
     */
    private fun changeSelfNickname(value: String) {
        selfNickname = value
        val normalized = com.aaiagent.engine.SelfNicknamePolicy.normalize(value)
        lifecycleScope.launch(Dispatchers.IO) {
            val platform = repository.getConfig(HostingSessionPolicy.PLATFORM_KEY)
                ?.takeIf { it.isNotBlank() } ?: "soul"
            repository.setConfig(
                com.aaiagent.engine.SelfNicknamePolicy.configKey(platform),
                normalized
            )
        }
        android.util.Log.d("AIA", "self nickname changed length=${normalized.length}")
    }

    /**
     * 手动跑一次语音发送，用来在真机上验证"点录音 → 暂停 → 发语音"这条链路。
     *
     * 只发一条、不参与自动回复；接入配音和注入之前先靠它确认手脚能动。
     * 按之前请先停在目标联系人的 Soul 聊天页。
     */
    private fun runVoiceTest() {
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        if (engine == null) {
            voiceTestStatus = "✗ 无障碍服务未启动"
            return
        }
        voiceTestStatus = "正在合成配音…"
        lifecycleScope.launch {
            voiceTestStatus = withContext(Dispatchers.Main.immediate) {
                engine.runVoiceSendTest()
            }
        }
    }

    private fun syncPlatform(platform: String) {
        platformSyncStatus = "同步中..."
        lifecycleScope.launch {
            try { val r = ApiService(apiBase).saveConfig(token, mapOf("action" to "switch_platform", "platform" to platform)); platformSyncStatus = if (r.success) "✓ 已切换到${platformDisplayName(platform)}" else "✗ 切换失败" }
            catch (_: Exception) { platformSyncStatus = "✗ 切换失败" }
        }
    }

    private fun syncWeather() {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                repository.setConfig(HostingSessionPolicy.WEATHER_KEY, weatherEnabled.toString())
            }
            try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_weather", "enabled" to weatherEnabled.toString())) } catch (_: Exception) {}
        }
    }

    private fun syncLine() {
        val line = if (lineA) "a" else "b"
        val lineName = if (lineA) "线路A" else "线路B"
        lifecycleScope.launch {
            withContext(Dispatchers.IO) { repository.setConfig(MODEL_LINE_KEY, line) }
            setLineHealth(line, ModelLineHealthState.CHECKING, "正在保存并检测 $lineName…")
            if (token.isBlank()) {
                setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 保存失败：请先验证设备钥匙")
                return@launch
            }
            val saveResult = runCatching {
                ApiService(apiBase).saveConfig(token, mapOf("action" to "switch_line", "line" to line))
            }.getOrElse {
                setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 保存失败：${it.message ?: "网络错误"}")
                return@launch
            }
            if (!saveResult.success) {
                setLineHealth(
                    line,
                    ModelLineHealthState.FAILED,
                    "✗ $lineName 保存失败：${
                        listOf(saveResult.error, saveResult.message).firstOrNull { !it.isNullOrBlank() }
                            ?: "云端未确认"
                    }"
                )
                return@launch
            }
            checkModelLineHealth(line)
        }
    }

    private fun checkSelectedLineHealth() {
        val line = if (lineA) "a" else "b"
        lifecycleScope.launch { checkModelLineHealth(line) }
    }

    private suspend fun checkModelLineHealth(line: String) {
        val lineName = if (line == "b") "线路B" else "线路A"
        setLineHealth(line, ModelLineHealthState.CHECKING, "正在检测 $lineName…")
        if (token.isBlank()) {
            setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 连接失败：请先验证设备钥匙")
            return
        }
        val result = runCatching {
            ApiService(apiBase).checkModelRouteHealth(token, line)
        }.getOrElse {
            com.aaiagent.network.ModelRouteHealthResponse(
                ok = false,
                line = line,
                error = it.message ?: "网络错误"
            )
        }
        if (result.ok) {
            val latency = result.latencyMs?.let { " · ${it}ms" }.orEmpty()
            setLineHealth(line, ModelLineHealthState.CONNECTED, "✓ $lineName 已连接$latency")
        } else {
            setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 连接失败：${result.error ?: "线路不可用"}")
        }
    }

    private fun setLineHealth(line: String, state: ModelLineHealthState, message: String) {
        if (line == "b") {
            lineHealthB = state
        } else {
            lineHealthA = state
        }
        if ((lineA && line == "a") || (!lineA && line == "b")) {
            lineHealthMessage = message
        }
    }

    private fun syncTime() {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                repository.setConfig(HostingSessionPolicy.TIME_KEY, timeEnabled.toString())
            }
            try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_time", "enabled" to timeEnabled.toString())) } catch (_: Exception) {}
        }
    }

    private fun updateContactWhitelist(values: List<String>) {
        val normalized = ContactListCodec.normalize(values)
        contactWhitelist = normalized
        lifecycleScope.launch(Dispatchers.IO) { repository.setContactWhitelist(normalized) }
    }

    private fun updateContactBlacklist(values: List<String>) {
        val normalized = ContactListCodec.normalize(values)
        contactBlacklist = normalized
        lifecycleScope.launch(Dispatchers.IO) { repository.setContactBlacklist(normalized) }
    }

    private fun platformDisplayName(p: String) = when(p) { "soul" -> "Soul"; "qq" -> "QQ"; "douban" -> "豆瓣"; "lianxin" -> "连信"; else -> p }

    // ═══ 托管 ═══

    // ═══ 托管 ═══
    private fun selectHostingMode(mode: HostingMode) {
        hostingMode = mode
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        if (engine?.hostingEnabled == true) {
            engine.hostingMode = mode
            HostingSessionPolicy.markStarted(engine.currentPlatform, mode)
        }
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(HostingSessionPolicy.MODE_KEY, mode.name)
        }
        android.util.Log.d("AIA", "Hosting mode selected mode=$mode persisted=true")
    }

    private fun toggleHosting(enable: Boolean) {
        val platform = enabledPlatforms.firstOrNull() ?: "soul"
        val mode = hostingMode
        android.util.Log.d("AIA", "Hosting toggle requested enable=$enable source=main platform=$platform mode=$mode")
        isHosting = enable
        engineState = if (enable) "启动中..." else "正在关闭..."
        lifecycleScope.launch {
            val result = HostingController.setHosting(
                context = this@MainActivity,
                enable = enable,
                platformOverride = platform,
                modeOverride = mode
            )
            isHosting = result.enabled
            engineState = result.message
            if (result.success && result.enabled) {
                com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.let(::startHostingPolling)
            } else if (!result.enabled) {
                statePollJob?.cancel()
            }
            if (!result.success && enable) {
                tokenVerifyStatus = "✗ ${result.message}"
            }
        }
    }
    private fun startHostingPolling(engine: com.aaiagent.engine.MessageEngine) {
        statePollJob?.cancel()
        statePollJob = lifecycleScope.launch {
            while (isHosting) {
                engineState = engine.currentState().toString()
                kotlinx.coroutines.delay(500)
            }
        }
    }

    private fun resumeRequestedHosting() {
        lifecycleScope.launch {
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine ?: return@launch
            if (engine.hostingEnabled) return@launch

            val session = HostingSessionPolicy.processSession() ?: run {
                if (!HostingSessionPolicy.canRestoreFromPersistence()) return@launch
                val saved = withContext(Dispatchers.IO) {
                    listOf(
                        repository.getConfig(HostingSessionPolicy.ENABLED_KEY),
                        repository.getActiveToken()?.token?.trim(),
                        repository.getConfig(HostingSessionPolicy.PLATFORM_KEY),
                        repository.getConfig(HostingSessionPolicy.MODE_KEY)
                    )
                }
                HostingSessionPolicy.restoredSession(
                    enabledValue = saved[0],
                    token = saved[1],
                    platformValue = saved[2],
                    modeValue = saved[3]
                )
            } ?: return@launch

            engine.hostingMode = session.mode
            engine.startHosting(session.platform)
            HostingSessionPolicy.markStarted(session.platform, session.mode)
            isHosting = true
            hostingMode = session.mode
            startHostingPolling(engine)
        }
    }

    private fun requestPermissions() {
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.M..Build.VERSION_CODES.P) {
            requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 1002)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
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

    private companion object {
        const val MODEL_LINE_KEY = "model_line"
    }
}
