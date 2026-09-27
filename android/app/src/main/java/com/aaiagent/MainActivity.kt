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
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.data.repository.ContactListCodec
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.network.ApiService
import com.aaiagent.service.ForegroundService
import com.aaiagent.service.HostingController
import com.aaiagent.ui.screens.DashboardScreen
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    private var tokenVerified by mutableStateOf(false)
    private var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    private var enabledPlatforms by mutableStateOf(setOf("soul"))
    private var personas by mutableStateOf<List<PersonaItem>>(emptyList())
    private var activePersonaId by mutableStateOf("female")
    private var homeCity by mutableStateOf("重庆")
    private var homeDistrict by mutableStateOf("两江新区")
    private var workCity by mutableStateOf("重庆")
    private var workDistrict by mutableStateOf("两江新区")
    private var contactWhitelist by mutableStateOf<List<String>>(emptyList())
    private var contactBlacklist by mutableStateOf<List<String>>(emptyList())

    // 验证状态
    private var personaVerifyStatus by mutableStateOf("")
    private var tokenVerifyStatus by mutableStateOf("")
    private var locationSaveStatus by mutableStateOf("")
    private var platformSyncStatus by mutableStateOf("")

    // 天气/时间感知
    private var weatherEnabled by mutableStateOf(true)
    private var timeEnabled by mutableStateOf(true)

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
            val t = withContext(Dispatchers.IO) { repository.getActiveToken() }; if (t != null) token = t.token
            if (t != null) {
                token = t.token
                tokenVerified = true
                tokenVerifyStatus = "✓ 钥匙已保存"
            }
            val u = withContext(Dispatchers.IO) { repository.getConfig("api_base_url") }; if (u != null) apiBase = u
            val loc = withContext(Dispatchers.IO) { repository.getLocation() }
            homeCity = loc["home"]?.get("city") ?: "重庆"; homeDistrict = loc["home"]?.get("district") ?: "两江新区"
            workCity = loc["work"]?.get("city") ?: "重庆"; workDistrict = loc["work"]?.get("district") ?: "两江新区"
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
                    onTogglePlatform = { p, en -> enabledPlatforms = if (en) setOf(p) else enabledPlatforms },
                    personas = personas, activePersonaId = activePersonaId,
                    onPersonaChange = { id -> activatePersona(id) },
                    token = token,
                    onTokenChange = { token = it.trim(); tokenVerified = false; tokenVerifyStatus = "" },
                    location = UserLocationEntity(homeCity = homeCity, homeDistrict = homeDistrict, workCity = workCity, workDistrict = workDistrict),
                    onLocationSave = { hc, hd, wc, wd -> homeCity = hc; homeDistrict = hd; workCity = wc; workDistrict = wd },
                    hostingMode = hostingMode, onHostingModeChange = { hostingMode = it },
                    onToggleHosting = { toggleHosting(it) },
                    personaVerifyStatus = personaVerifyStatus, onVerifyPersona = { verifyPersona() },
                    locationSaveStatus = locationSaveStatus, onSaveLocation = { saveLocation() },
                    tokenVerifyStatus = tokenVerifyStatus, onVerifyToken = { verifyToken() },
                    platformSyncStatus = platformSyncStatus, onSyncPlatform = { syncPlatform(it) },
                    weatherEnabled = weatherEnabled, onWeatherToggle = { weatherEnabled = it; syncWeather() },
                    timeEnabled = timeEnabled, onTimeToggle = { timeEnabled = it; syncTime() },
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
            if (serverHomeCity != null && serverHomeDistrict != null) {
                homeCity = serverHomeCity
                homeDistrict = serverHomeDistrict
            }
            if (serverWorkCity != null && serverWorkDistrict != null) {
                workCity = serverWorkCity
                workDistrict = serverWorkDistrict
            }
            withContext(Dispatchers.IO) {
                repository.setLocation(homeCity, homeDistrict, workCity, workDistrict)
            }
        } catch (_: Exception) {}
    }

    // ═══ 验证函数 ═══

    private fun verifyToken() {
        val candidate = token.trim()
        if (candidate.isEmpty()) {
            tokenVerified = false
            tokenVerifyStatus = "✗ 请先输入设备钥匙"
            return
        }
        token = candidate
        tokenVerified = false
        tokenVerifyStatus = "验证中..."
        lifecycleScope.launch {
            try {
                val r = ApiService(apiBase).saveConfig(candidate, mapOf("action" to "verify_token"))
                if (r.success) {
                    withContext(Dispatchers.IO) { repository.activateVerifiedToken(candidate) }
                    tokenVerified = true
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

    private fun saveLocation() {
        if (token.isBlank()) {
            locationSaveStatus = "✗ 请先验证设备钥匙"
            return
        }
        locationSaveStatus = "保存中..."
        lifecycleScope.launch {
            try {
                val r = ApiService(apiBase).saveConfig(
                    token,
                    mapOf(
                        "action" to "save_location",
                        "home_city" to homeCity,
                        "home_district" to homeDistrict,
                        "work_city" to workCity,
                        "work_district" to workDistrict
                    )
                )
                if (r.success) {
                    withContext(Dispatchers.IO) { repository.setLocation(homeCity, homeDistrict, workCity, workDistrict) }
                    locationSaveStatus = "✓ 位置已同步"
                } else {
                    locationSaveStatus = "✗ ${r.error ?: "保存失败"}"
                }
            } catch (_: Exception) { locationSaveStatus = "✗ 保存失败" }
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
            try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_weather", "enabled" to weatherEnabled.toString())) } catch (_: Exception) {}
        }
    }

    private fun syncTime() {
        lifecycleScope.launch {
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

    private fun platformDisplayName(p: String) = when(p) { "soul" -> "Soul"; "qq" -> "QQ"; "immomo" -> "陌陌"; "lianxin" -> "连信"; else -> p }

    // ═══ 托管 ═══

    // ═══ 托管 ═══
    private fun toggleHosting(enable: Boolean) {
        val platform = enabledPlatforms.firstOrNull() ?: "soul"
        val mode = hostingMode
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
}
