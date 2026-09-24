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
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity
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
    private var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    private var enabledPlatforms by mutableStateOf(setOf("soul"))
    private var personas by mutableStateOf<List<PersonaItem>>(emptyList())
    private var activePersonaId by mutableStateOf("female")
    private var homeCity by mutableStateOf("重庆")
    private var homeDistrict by mutableStateOf("两江新区")
    private var workCity by mutableStateOf("重庆")
    private var workDistrict by mutableStateOf("两江新区")
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
                    if (!isHosting) toggleHosting(true)
                }
            }
        }, IntentFilter("com.aaiagent.TRIGGER_HOSTING"))
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)

        lifecycleScope.launch {
            val t = withContext(Dispatchers.IO) { repository.getActiveToken() }; if (t != null) token = t.token
            val u = withContext(Dispatchers.IO) { repository.getConfig("api_base_url") }; if (u != null) apiBase = u
            val loc = withContext(Dispatchers.IO) { repository.getLocation() }
            homeCity = loc["home"]?.get("city") ?: "重庆"; homeDistrict = loc["home"]?.get("district") ?: "两江新区"
            workCity = loc["work"]?.get("city") ?: "重庆"; workDistrict = loc["work"]?.get("district") ?: "两江新区"
            try { loadPersonas() } catch (_: Exception) {}
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
                    onPersonaChange = { id -> activePersonaId = id; lifecycleScope.launch { withContext(Dispatchers.IO) { repository.setConfig("persona_id", id) } } },
                    token = token, apiBase = apiBase,
                    onTokenChange = { token = it; lifecycleScope.launch { withContext(Dispatchers.IO) { repository.saveToken(TokenEntity(token = it)) } } },
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
                    onOpenWhitelist = { /* TODO */ }, onOpenBlacklist = { /* TODO */ },
                    sendMode = sendMode, onSendModeChange = { sendMode = it }
                )
            }
        }
        requestPermissions()
    }

    private suspend fun loadPersonas() {
        try {
            val data = withContext(Dispatchers.IO) { okhttp3.OkHttpClient().newCall(okhttp3.Request.Builder().url("$apiBase/api/persona").get().build()).execute().body?.string() ?: "{}" }
            val list = com.google.gson.Gson().fromJson(data, Map::class.java)?.get("personas") as? List<*>
            if (list != null) { personas = list.mapNotNull { val o = it as? Map<*, *> ?: return@mapNotNull null; PersonaItem(o["id"] as? String ?: "", o["name"] as? String ?: "") }; if (personas.isNotEmpty() && personas.none { it.id == activePersonaId }) activePersonaId = personas.first().id }
        } catch (_: Exception) {}
    }

    // ═══ 验证函数 ═══

    private fun verifyToken() {
        if (token.isEmpty()) return; tokenVerifyStatus = "验证中..."
        lifecycleScope.launch {
            try { val r = ApiService(apiBase).saveConfig(token, mapOf("action" to "verify_token")); tokenVerifyStatus = if (r.success) "✓ 钥匙有效" else "✗ ${r.error ?: "钥匙无效"}" }
            catch (_: Exception) { tokenVerifyStatus = "✗ 验证失败" }
        }
    }

    private fun verifyPersona() {
        personaVerifyStatus = "验证中..."
        lifecycleScope.launch {
            try { val r = ApiService(apiBase).saveConfig(token, mapOf("action" to "verify_persona", "persona_id" to activePersonaId)); personaVerifyStatus = if (r.success) "✓ 人设已同步" else "✗ 同步失败" }
            catch (_: Exception) { personaVerifyStatus = "✗ 同步失败" }
        }
    }

    private fun saveLocation() {
        locationSaveStatus = "保存中..."
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) { repository.setLocation(homeCity, homeDistrict, workCity, workDistrict) }
                val r = ApiService(apiBase).saveConfig(token, mapOf("action" to "save_location", "home_city" to homeCity, "home_district" to homeDistrict, "work_city" to workCity, "work_district" to workDistrict))
                locationSaveStatus = if (r.success) "✓ 位置已保存" else "✗ ${r.error ?: "保存失败"}"
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

    private fun platformDisplayName(p: String) = when(p) { "soul" -> "Soul"; "qq" -> "QQ"; "immomo" -> "陌陌"; "lianxin" -> "连信"; else -> p }

    // ═══ 托管 ═══

    // ═══ 托管 ═══
    private fun toggleHosting(enable: Boolean) {
        isHosting = enable; floatingWindow?.updateHostingState(enable)
        if (enable) {
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
