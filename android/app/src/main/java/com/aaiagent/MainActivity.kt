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
import androidx.lifecycle.lifecycleScope
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.data.repository.ContactListCodec
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.HostingMode
import com.aaiagent.network.ApiService
import com.aaiagent.service.ForegroundService
import com.aaiagent.ui.components.FloatingWindow
import com.aaiagent.ui.screens.DashboardScreen
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private lateinit var repository: AppRepository
    private var floatingWindow: FloatingWindow? = null
    private var statePollJob: Job? = null

    // 核心状态
    private var isHosting by mutableStateOf(false)
    private var hostingMode by mutableStateOf(HostingMode.FULL_AUTO)
    private var sendMode by mutableStateOf("auto")
    private var engineState by mutableStateOf("IDLE")
    private var lastReply by mutableStateOf<String?>(null)
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
    private val platformsStatus = mutableStateMapOf("soul" to false, "qq" to false, "immomo" to false, "lianxin" to false)

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
        registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == "com.aaiagent.TRIGGER_HOSTING") {
                    android.util.Log.d("AIA", "TRIGGER_HOSTING broadcast received")
                    val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
                    if (engine?.hostingEnabled != true) toggleHosting(true)
                }
            }
        }, IntentFilter("com.aaiagent.TRIGGER_HOSTING"))
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
            platformsStatus[enabledPlatforms.firstOrNull() ?: "soul"] = true
        }

        setContent {
            AaiagentTheme {
                DashboardScreen(
                    isHosting = isHosting, engineState = engineState, lastReply = lastReply,
                    platformsStatus = platformsStatus, enabledPlatforms = enabledPlatforms,
                    onTogglePlatform = { p, en -> enabledPlatforms = if (en) setOf(p) else enabledPlatforms },
                    personas = personas, activePersonaId = activePersonaId,
                    onPersonaChange = { id -> activatePersona(id) },
                    token = token, apiBase = apiBase,
                    onTokenChange = { token = it.trim(); tokenVerified = false; tokenVerifyStatus = "" },
                    onApiBaseChange = { apiBase = it },
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
                    onContactBlacklistChange = { updateContactBlacklist(it) },
                    sendMode = sendMode, onSendModeChange = { sendMode = it }
                )
            }
        }
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
        isHosting = enable; floatingWindow?.updateHostingState(enable)
        if (enable) {
            if (!tokenVerified) {
                isHosting = false
                floatingWindow?.updateHostingState(false)
                engineState = "请先验证设备钥匙"
                tokenVerifyStatus = "✗ 请先验证设备钥匙"
                return
            }
            startForegroundService(); val platform = enabledPlatforms.firstOrNull() ?: "soul"; platformsStatus[platform] = true
            lifecycleScope.launch { if (token.isNotEmpty()) { try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_hosting", "enabled" to "true")) } catch (_: Exception) {} } }
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
            if (engine != null) {
                engine.hostingMode = hostingMode
                engine.startHosting(platform)
                // 启动状态轮询
                statePollJob?.cancel()
                statePollJob = lifecycleScope.launch {
                    while (isHosting) {
                        engineState = com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.currentState().toString()
                        kotlinx.coroutines.delay(500)
                    }
                }
            } else {
                // 无障碍服务未启动，提示用户
                android.util.Log.e("AIA", "toggleHosting: sharedEngine is null! AccessibilityService not running.")
                engineState = "无障碍服务未启动"
                // 回滚状态
                isHosting = false
                floatingWindow?.updateHostingState(false)
                platformsStatus.keys.forEach { platformsStatus[it] = false }
            }
        } else {
            com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.stopHosting()
            platformsStatus.keys.forEach { platformsStatus[it] = false }; statePollJob?.cancel(); engineState = "IDLE"
            lifecycleScope.launch { if (token.isNotEmpty()) { try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_hosting", "enabled" to "false")) } catch (_: Exception) {} } }
        }
    }

    private fun startForegroundService() { val i = Intent(this, ForegroundService::class.java); if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i) }
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
            platformsStatus[enabledPlatforms.firstOrNull() ?: "soul"] = true
        } else {
            platformsStatus.keys.forEach { platformsStatus[it] = false }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return
        if (floatingWindow == null || floatingWindow?.isShowing() == false) { floatingWindow = FloatingWindow(this); floatingWindow?.show(hosting = isHosting, toggleListener = { toggleHosting(it) }, longClickListener = { startActivity(Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT }) }) }
    }

    override fun onDestroy() { floatingWindow?.hide(); super.onDestroy() }
}
