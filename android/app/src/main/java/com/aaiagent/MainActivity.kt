package com.aaiagent

import android.content.Intent
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

    private var isHosting by mutableStateOf(false)
    private var monitorMode by mutableStateOf(false)
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
    private val platformsStatus = mutableStateMapOf(
        "soul" to false, "qq" to false, "immomo" to false, "lianxin" to false
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)

        lifecycleScope.launch {
            val savedToken = withContext(Dispatchers.IO) { repository.getActiveToken() }
            if (savedToken != null) token = savedToken.token
            val savedApiBase = withContext(Dispatchers.IO) { repository.getConfig("api_base_url") }
            if (savedApiBase != null) apiBase = savedApiBase
            val loc = withContext(Dispatchers.IO) { repository.getLocation() }
            homeCity = loc["home"]?.get("city") ?: "重庆"
            homeDistrict = loc["home"]?.get("district") ?: "两江新区"
            workCity = loc["work"]?.get("city") ?: "重庆"
            workDistrict = loc["work"]?.get("district") ?: "两江新区"
            try {
                val api = ApiService(apiBase)
                loadPersonas(api)
            } catch (_: Exception) {}
        }

        setContent {
            AaiagentTheme {
                DashboardScreen(
                    isHosting = isHosting,
                    engineState = engineState,
                    lastReply = lastReply,
                    platformsStatus = platformsStatus,
                    enabledPlatforms = enabledPlatforms,
                    onTogglePlatform = { platform, enabled ->
                        enabledPlatforms = if (enabled) setOf(platform) else enabledPlatforms
                    },
                    personas = personas,
                    activePersonaId = activePersonaId,
                    onPersonaChange = { id ->
                        activePersonaId = id
                        lifecycleScope.launch {
                            withContext(Dispatchers.IO) {
                                repository.setConfig("persona_id", id)
                            }
                        }
                    },
                    token = token,
                    apiBase = apiBase,
                    onTokenChange = { newToken ->
                        token = newToken
                        lifecycleScope.launch {
                            withContext(Dispatchers.IO) {
                                repository.saveToken(TokenEntity(token = newToken))
                            }
                        }
                    },
                    onApiBaseChange = { newBase ->
                        apiBase = newBase
                        lifecycleScope.launch {
                            withContext(Dispatchers.IO) {
                                repository.setConfig("api_base_url", newBase)
                            }
                        }
                    },
                    location = UserLocationEntity(
                        homeCity = homeCity, homeDistrict = homeDistrict,
                        workCity = workCity, workDistrict = workDistrict
                    ),
                    onLocationSave = { hc, hd, wc, wd ->
                        homeCity = hc; homeDistrict = hd
                        workCity = wc; workDistrict = wd
                        lifecycleScope.launch {
                            withContext(Dispatchers.IO) {
                                repository.setLocation(hc, hd, wc, wd)
                            }
                        }
                    },
                    monitorMode = monitorMode,
                    onMonitorModeChange = { monitorMode = it },
                    onToggleHosting = { toggleHosting(it) }
                )
            }
        }

        // 清零引擎状态，防止上次托管残留
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        engine?.stopHosting()
        requestPermissions()
    }

    private suspend fun loadPersonas(api: ApiService) {
        try {
            val data = withContext(Dispatchers.IO) {
                val req = okhttp3.Request.Builder().url(apiBase + "/api/persona").get().build()
                val client = okhttp3.OkHttpClient()
                client.newCall(req).execute().body?.string() ?: "{}"
            }
            val gson = com.google.gson.Gson()
            val json = gson.fromJson(data, Map::class.java) as? Map<*, *>
            val list = json?.get("personas") as? List<*>
            if (list != null) {
                personas = list.mapNotNull { item ->
                    val obj = item as? Map<*, *> ?: return@mapNotNull null
                    PersonaItem(
                        id = obj["id"] as? String ?: "",
                        name = obj["name"] as? String ?: "",
                        systemPrompt = obj["system_prompt"] as? String ?: ""
                    )
                }
                val active = personas.find { it.id == activePersonaId }
                if (active == null && personas.isNotEmpty()) activePersonaId = personas.first().id
            }
        } catch (_: Exception) {}
    }

    private fun toggleHosting(enable: Boolean) {
        isHosting = enable
        floatingWindow?.updateHostingState(enable)
        if (enable) {
            startForegroundService()
            val platform = enabledPlatforms.firstOrNull() ?: "soul"
            platformsStatus[platform] = true
            lifecycleScope.launch {
                if (token.isNotEmpty()) {
                    try { ApiService(apiBase).registerToken(token, Build.MODEL) } catch (_: Exception) {}
                }
            }
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
            if (engine != null) {
                engine.startHosting(platform)
                android.util.Log.d("AIA", "Hosting started for platform=$platform")
            }
            statePollJob?.cancel()
            statePollJob = lifecycleScope.launch {
                while (isHosting) {
                    engineState = com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.currentState().toString()
                    kotlinx.coroutines.delay(500)
                }
            }
        } else {
            com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.stopHosting()
            platformsStatus.keys.forEach { platformsStatus[it] = false }
            statePollJob?.cancel()
            engineState = "IDLE"
        }
    }

    private fun startForegroundService() {
        val intent = Intent(this, ForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }

    private fun requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
    }

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) return
        if (floatingWindow == null || floatingWindow?.isShowing() == false) {
            floatingWindow = FloatingWindow(this)
            floatingWindow?.show(
                hosting = isHosting,
                toggleListener = { toggleHosting(it) },
                longClickListener = {
                    val intent = Intent(this, MainActivity::class.java)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    startActivity(intent)
                }
            )
        }
    }

    override fun onDestroy() {
        floatingWindow?.hide()
        super.onDestroy()
    }
}