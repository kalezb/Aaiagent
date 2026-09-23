package com.aaiagent

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.db.entity.TokenEntity
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.service.ForegroundService
import com.aaiagent.ui.components.FloatingWindow
import com.aaiagent.ui.screens.ConsoleScreen
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.screens.RecordsScreen
import com.aaiagent.ui.screens.SettingsScreen
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.lifecycle.lifecycleScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {

    private lateinit var repository: AppRepository
    private var floatingWindow: FloatingWindow? = null

    private var isHosting by mutableStateOf(false)
    private var monitorMode by mutableStateOf(false)
    private var engineState by mutableStateOf("IDLE")
    private var lastReply by mutableStateOf<String?>(null)
    private var token by mutableStateOf("")
    private var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    private var selectedTab by mutableIntStateOf(0)
    private var enabledPlatforms by mutableStateOf(setOf("soul"))

    // ???
    private var personas by mutableStateOf<List<PersonaItem>>(emptyList())
    private var activePersonaId by mutableStateOf("female")

    // ???
    private var homeCity by mutableStateOf("???")
    private var homeDistrict by mutableStateOf("??????")
    private var workCity by mutableStateOf("???")
    private var workDistrict by mutableStateOf("??????")

    private val platforms = listOf("soul", "qq", "immomo", "lianxin")
    private val platformsStatus = mutableStateMapOf(
        "soul" to false, "qq" to false, "immomo" to false, "lianxin" to false
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)

        // ?????????
        lifecycleScope.launch {
            val savedToken = withContext(Dispatchers.IO) { repository.getActiveToken() }
            if (savedToken != null) token = savedToken.token

            val savedApiBase = withContext(Dispatchers.IO) { repository.getConfig("api_base_url") }
            if (savedApiBase != null) apiBase = savedApiBase

            // ???
            val loc = withContext(Dispatchers.IO) { repository.getLocation() }
            homeCity = loc["home"]?.get("city") ?: "???"
            homeDistrict = loc["home"]?.get("district") ?: "??????"
            workCity = loc["work"]?.get("city") ?: "???"
            workDistrict = loc["work"]?.get("district") ?: "??????"

            // ???
            try {
                val api = ApiService(apiBase)
                val config = api.getConfig(token)
                loadPersonas(api)
            } catch (_: Exception) {}
        }

        setContent {
            AaiagentTheme {
                Scaffold(
                    bottomBar = {
                        NavigationBar(
                            containerColor = SurfaceDark,
                            contentColor = TextPrimary
                        ) {
                            NavigationBarItem(
                                selected = selectedTab == 0,
                                onClick = { selectedTab = 0 },
                                icon = { Icon(Icons.Default.PlayArrow, contentDescription = null) },
                                label = { Text("???") },
                                colors = navColors()
                            )
                            NavigationBarItem(
                                selected = selectedTab == 1,
                                onClick = { selectedTab = 1 },
                                icon = { Icon(Icons.Default.List, contentDescription = null) },
                                label = { Text("???") },
                                colors = navColors()
                            )
                            NavigationBarItem(
                                selected = selectedTab == 2,
                                onClick = { selectedTab = 2 },
                                icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                label = { Text("???") },
                                colors = navColors()
                            )
                        }
                    }
                ) { padding ->
                    Box(modifier = Modifier.padding(padding)) {
                        when (selectedTab) {
                            0 -> ConsoleScreen(
                                isHosting = isHosting,
                                onToggleHosting = { toggleHosting(it) },
                                platformsStatus = platformsStatus,
                                engineState = engineState,
                                lastReply = lastReply
                            )
                            1 -> RecordsScreen(
                                token = token,
                                apiBaseUrl = apiBase
                            )
                            2 -> SettingsScreen(
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
                                platforms = platforms,
                                enabledPlatforms = enabledPlatforms,
                                onTogglePlatform = { platform, enabled ->
                                    enabledPlatforms = if (enabled) setOf(platform) else enabledPlatforms
                                },
                                personas = personas,
                                activePersonaId = activePersonaId,
                                onPersonaChange = { id ->
                                    activePersonaId = id
                                    lifecycleScope.launch {
                                        try {
                                            val api = ApiService(apiBase)
                                            // ????????????
                                            withContext(Dispatchers.IO) {
                                                // ??? token ??????
                                                kotlinx.coroutines.withContext(Dispatchers.IO) {
                                                    val json = com.google.gson.Gson().toJson(
                                                        mapOf("id" to id, "name" to "", "system_prompt" to "", "is_active" to 1)
                                                    )
                                                    val body = json.toByteArray()
                                                    // removed broken import
                                                    // ???????? repository ???
                                                    repository.setConfig("persona_id", id)
                                                }
                                            }
                                            loadPersonas(api)
                                        } catch (_: Exception) {}
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
                                isHosting = isHosting,
                                onToggleHosting = { toggleHosting(it) }
                            )
                        }
                    }
                }
            }
        }

        requestPermissions()
    }

    private suspend fun loadPersonas(api: ApiService) {
        try {
            val data = withContext(Dispatchers.IO) {
                val req = okhttp3.Request.Builder()
                    .url(apiBase + "/api/persona")
                    .get()
                    .build()
                val client = okhttp3.OkHttpClient()
                val resp = client.newCall(req).execute()
                resp.body?.string() ?: "{}"
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
                if (active == null && personas.isNotEmpty()) {
                    activePersonaId = personas.first().id
                }
            }
        } catch (_: Exception) {}
    }

    private fun toggleHosting(enable: Boolean) {
        isHosting = enable
        floatingWindow?.updateHostingState(enable)

        if (enable) {
            startForegroundService()
            lifecycleScope.launch {
                if (token.isNotEmpty()) {
                    try {
                        val api = ApiService(apiBase)
                        api.registerToken(token, Build.MODEL)
                    } catch (_: Exception) {}
                }
            }
            // Trigger the engine to start scanning
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
            if (engine != null) {
                val platform = enabledPlatforms.firstOrNull() ?: "soul"
                engine.startHosting(platform)
                android.util.Log.d("AIA", "Hosting started for platform=$platform")
            }
        } else {
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
            engine?.stopHosting()
        }
    }

    private fun startForegroundService() {
        val intent = Intent(this, ForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
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

    @Composable
    private fun navColors() = NavigationBarItemDefaults.colors(
        selectedIconColor = Green,
        selectedTextColor = Green,
        indicatorColor = Green.copy(alpha = 0.15f)
    )

    override fun onDestroy() {
        floatingWindow?.hide()
        super.onDestroy()
    }
}
