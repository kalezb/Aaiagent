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
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.service.ForegroundService
import com.aaiagent.ui.components.FloatingWindow
import com.aaiagent.ui.screens.ConsoleScreen
import com.aaiagent.ui.screens.RecordsScreen
import com.aaiagent.ui.screens.SettingsScreen
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var repository: AppRepository
    private var floatingWindow: FloatingWindow? = null
    private var isHosting by mutableStateOf(false)
    private var engineState by mutableStateOf("IDLE")
    private var lastReply by mutableStateOf<String?>(null)
    private var token by mutableStateOf("")
    private var apiBase by mutableStateOf("https://ai-agent-api.pages.dev")
    private var selectedTab by mutableIntStateOf(0)
    private var enabledPlatforms by mutableStateOf(setOf("soul", "qq", "immomo", "lianxin"))

    private val platforms = listOf("soul", "qq", "immomo", "lianxin")
    private val platformsStatus = mutableStateMapOf(
        "soul" to false, "qq" to false, "immomo" to false, "lianxin" to false
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)

        // 加载配置
        val savedToken = repository.getActiveToken()
        if (savedToken != null) {
            token = savedToken.token
        }
        val savedApiBase = repository.getConfig("api_base_url")
        if (savedApiBase != null) {
            apiBase = savedApiBase
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
                                icon = { Icon(Icons.Default.Home, contentDescription = null) },
                                label = { Text("控制台") },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Green,
                                    selectedTextColor = Green,
                                    indicatorColor = Green.copy(alpha = 0.15f)
                                )
                            )
                            NavigationBarItem(
                                selected = selectedTab == 1,
                                onClick = { selectedTab = 1 },
                                icon = { Icon(Icons.Default.List, contentDescription = null) },
                                label = { Text("记录") },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Green,
                                    selectedTextColor = Green,
                                    indicatorColor = Green.copy(alpha = 0.15f)
                                )
                            )
                            NavigationBarItem(
                                selected = selectedTab == 2,
                                onClick = { selectedTab = 2 },
                                icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                                label = { Text("设置") },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Green,
                                    selectedTextColor = Green,
                                    indicatorColor = Green.copy(alpha = 0.15f)
                                )
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
                                    repository.saveToken(
                                        com.aaiagent.data.db.entity.TokenEntity(token = newToken)
                                    )
                                },
                                onApiBaseChange = { newBase ->
                                    apiBase = newBase
                                    repository.setConfig("api_base_url", newBase)
                                },
                                platforms = platforms,
                                enabledPlatforms = enabledPlatforms,
                                onTogglePlatform = { platform, enabled ->
                                    enabledPlatforms = if (enabled) {
                                        enabledPlatforms + platform
                                    } else {
                                        enabledPlatforms - platform
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }

        // 请求权限
        requestPermissions()
    }

    private fun toggleHosting(enable: Boolean) {
        isHosting = enable
        floatingWindow?.updateHostingState(enable)

        if (enable) {
            startForegroundService()
            // 注册 token
            kotlinx.coroutines.MainScope().launch {
                if (token.isNotEmpty()) {
                    val api = ApiService(apiBase)
                    api.registerToken(token, android.os.Build.MODEL)
                }
            }
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
        // 通知权限 (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        // 悬浮窗权限
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
        // 显示悬浮窗
        if (floatingWindow == null || floatingWindow?.isShowing() == false) {
            floatingWindow = FloatingWindow(this)
            floatingWindow?.show(
                hosting = isHosting,
                toggleListener = { toggleHosting(it) },
                longClickListener = {
                    // 长按打开主界面
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