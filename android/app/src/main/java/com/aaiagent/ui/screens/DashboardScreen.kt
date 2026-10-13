package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Image
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.aaiagent.R
import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.observability.AutomationTrace
import com.aaiagent.network.ApiService
import com.aaiagent.ui.theme.SkyBg
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyBlueDeep
import com.aaiagent.engine.VoiceOutputMode
import com.aaiagent.ui.theme.SkyBlueSoft
import com.aaiagent.ui.theme.SkyCyan
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyDangerSoft
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyGreenSoft
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyTextSecondary
import com.aaiagent.ui.theme.SkyWarm
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class ContactKind {
    WHITELIST,
    BLACKLIST
}
fun checkPermissionStatus(context: Context): PermissionStatus {
    val accessibility = runCatching {
        Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains(context.packageName) == true
    }.getOrDefault(false)

    val notification = runCatching {
        Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        )?.contains(context.packageName) == true
    }.getOrDefault(false)

    val batteryOptimization = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val manager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        manager.isIgnoringBatteryOptimizations(context.packageName)
    } else {
        true
    }

    val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
    } else {
        true
    }

    return PermissionStatus(accessibility, notification, batteryOptimization, overlay)
}

fun platformDisplayName(platform: String): String = when (platform) {
    "soul" -> "Soul"
    "qq" -> "QQ"
    "douban" -> "豆瓣"
    "lianxin" -> "连信"
    else -> platform
}

@Composable
fun DashboardScreen(
    isHosting: Boolean,
    engineState: String,
    enabledPlatforms: Set<String>,
    onTogglePlatform: (String, Boolean) -> Unit,
    personas: List<PersonaItem>,
    activePersonaId: String,
    onPersonaChange: (String) -> Unit,
    token: String,
    apiBase: String,
    onTokenChange: (String) -> Unit,
    personaFacts: PersonaFactsUiState,
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit,
    onToggleHosting: (Boolean) -> Unit,
    personaVerifyStatus: String,
    onVerifyPersona: () -> Unit,
    tokenVerifyStatus: String,
    onVerifyToken: () -> Unit,
    platformSyncStatus: String,
    onSyncPlatform: (String) -> Unit,
    voiceReplyEnabled: Boolean,
    onVoiceReplyToggle: (Boolean) -> Unit,
    voiceOutputMode: String,
    onVoiceOutputChange: (String) -> Unit,
    selfNickname: String,
    onSelfNicknameChange: (String) -> Unit,
    weatherEnabled: Boolean,
    onWeatherToggle: (Boolean) -> Unit,
    timeEnabled: Boolean,
    onTimeToggle: (Boolean) -> Unit,
    lineA: Boolean,
    onLineChange: (Boolean) -> Unit,
    lineHealthA: ModelLineHealthState,
    lineHealthB: ModelLineHealthState,
    lineHealthMessage: String,
    contactWhitelist: List<String>,
    contactBlacklist: List<String>,
    onContactWhitelistChange: (List<String>) -> Unit,
    onContactBlacklistChange: (List<String>) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val versionName = remember(context) {
        runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "unknown"
    }
    var permissions by remember { mutableStateOf(checkPermissionStatus(context)) }
    var contactDialog by remember { mutableStateOf<ContactKind?>(null) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permissions = checkPermissionStatus(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val activePlatform = DashboardUiPolicy.activePlatform(enabledPlatforms)
    val corePermissionsReady = permissions.accessibility && permissions.notification
    val tokenReady = tokenVerifyStatus.startsWith("✓")
    val selectedLineHealth = DashboardUiPolicy.selectedLineHealth(lineA, lineHealthA, lineHealthB)
    val lineName = if (lineA) "线路A" else "线路B"
    val connectionText = DashboardUiPolicy.connectionText(
        isHosting = isHosting,
        platform = activePlatform,
        corePermissionsReady = corePermissionsReady,
        tokenReady = tokenReady,
        lineHealth = selectedLineHealth,
        lineName = lineName
    )
    val connectionTone = DashboardUiPolicy.connectionTone(
        corePermissionsReady = corePermissionsReady,
        tokenReady = tokenReady,
        lineHealth = selectedLineHealth
    )
    val grantedPermissions = DashboardUiPolicy.healthyPermissionCount(
        permissions.accessibility,
        permissions.notification,
        permissions.batteryOptimization,
        permissions.overlay
    )

    Column(
        Modifier
            .fillMaxSize()
            .background(SkyBg)
            .verticalScroll(rememberScrollState())
            .padding(top = 16.dp, bottom = 36.dp)
    ) {
        DashboardHeader(
            versionName = versionName,
            connectionText = connectionText,
            connectionTone = connectionTone
        )

        Spacer(Modifier.height(16.dp))

        HostingHero(
            isHosting = isHosting,
            engineState = engineState,
            platform = activePlatform,
            onToggleHosting = onToggleHosting
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "问题反馈与页面采样")
        IncidentFeedbackCard(apiBase = apiBase, token = token)

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "今日状态")
        OverviewStats(
            isHosting = isHosting,
            platform = activePlatform,
            whitelistCount = contactWhitelist.size,
            blacklistCount = contactBlacklist.size
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "托管方式")
        HostingModeSelector(hostingMode, onHostingModeChange)

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "快捷管理")
        QuickManagement(
            permissions = permissions,
            context = context,
            weatherEnabled = weatherEnabled,
            onWeatherToggle = onWeatherToggle,
            timeEnabled = timeEnabled,
            onTimeToggle = onTimeToggle,
            lineA = lineA,
            onLineChange = onLineChange,
            lineHealthA = lineHealthA,
            lineHealthB = lineHealthB,
            lineHealthMessage = lineHealthMessage
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "平台与人设")
        PlatformPersonaCard(
            enabledPlatforms = enabledPlatforms,
            onTogglePlatform = onTogglePlatform,
            syncPlatform = onSyncPlatform,
            personas = personas,
            activePersonaId = activePersonaId,
            onPersonaChange = onPersonaChange,
            personaVerifyStatus = personaVerifyStatus,
            onVerifyPersona = onVerifyPersona,
            platformSyncStatus = platformSyncStatus,
            voiceReplyEnabled = voiceReplyEnabled,
            onVoiceReplyToggle = onVoiceReplyToggle,
            voiceOutputMode = voiceOutputMode,
            onVoiceOutputChange = onVoiceOutputChange,
            selfNickname = selfNickname,
            onSelfNicknameChange = onSelfNicknameChange
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "共享人设资料")
        SharedPersonaFactsCard(facts = personaFacts, activePersonaId = activePersonaId)

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "客户策略")
        ContactStrategyCard(
            whitelistCount = contactWhitelist.size,
            blacklistCount = contactBlacklist.size,
            onOpenWhitelist = { contactDialog = ContactKind.WHITELIST },
            onOpenBlacklist = { contactDialog = ContactKind.BLACKLIST }
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "设备与安全")
        DeviceSecurityCard(
            token = token,
            onTokenChange = onTokenChange,
            tokenVerifyStatus = tokenVerifyStatus,
            onVerifyToken = onVerifyToken,
            grantedPermissions = grantedPermissions
        )
    }

    when (contactDialog) {
        ContactKind.WHITELIST -> ContactManagementDialog(
            title = "白名单管理",
            emptyText = "暂无白名单联系人",
            contacts = contactWhitelist,
            accent = SkyGreen,
            onDismiss = { contactDialog = null },
            onChange = onContactWhitelistChange
        )

        ContactKind.BLACKLIST -> ContactManagementDialog(
            title = "黑名单管理",
            emptyText = "暂无黑名单联系人",
            contacts = contactBlacklist,
            accent = SkyDanger,
            onDismiss = { contactDialog = null },
            onChange = onContactBlacklistChange
        )

        null -> Unit
    }
}
