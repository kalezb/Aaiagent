package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.animation.animateColorAsState
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
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Smartphone
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.theme.SkyBg
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyBlueDeep
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
import com.aaiagent.ui.theme.SkyWarmSoft

data class PermissionStatus(
    val accessibility: Boolean = false,
    val notification: Boolean = false,
    val batteryOptimization: Boolean = false,
    val overlay: Boolean = false
)

data class PersonaItem(
    val id: String,
    val name: String,
    val systemPrompt: String = "",
    val gender: String = "",
    val isActive: Boolean = false
)

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
    "immomo" -> "陌陌"
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
    onTokenChange: (String) -> Unit,
    location: UserLocationEntity,
    onLocationSave: (String, String, String, String) -> Unit,
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit,
    onToggleHosting: (Boolean) -> Unit,
    personaVerifyStatus: String,
    onVerifyPersona: () -> Unit,
    locationSaveStatus: String,
    onSaveLocation: () -> Unit,
    tokenVerifyStatus: String,
    onVerifyToken: () -> Unit,
    platformSyncStatus: String,
    onSyncPlatform: (String) -> Unit,
    weatherEnabled: Boolean,
    onWeatherToggle: (Boolean) -> Unit,
    timeEnabled: Boolean,
    onTimeToggle: (Boolean) -> Unit,
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
    val connectionText = DashboardUiPolicy.connectionText(
        isHosting = isHosting,
        platform = activePlatform,
        corePermissionsReady = corePermissionsReady,
        tokenReady = tokenReady
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
            connected = corePermissionsReady
        )

        Spacer(Modifier.height(16.dp))

        HostingHero(
            isHosting = isHosting,
            engineState = engineState,
            hostingMode = hostingMode,
            platform = activePlatform,
            onToggleHosting = onToggleHosting
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "今日状态", trailing = "实时更新")
        OverviewStats(
            isHosting = isHosting,
            platform = activePlatform,
            whitelistCount = contactWhitelist.size,
            blacklistCount = contactBlacklist.size
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "托管方式", trailing = "先选模式，再开托管")
        HostingModeSelector(hostingMode, onHostingModeChange)

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "快捷管理", trailing = "点按整行切换")
        QuickManagement(
            permissions = permissions,
            context = context,
            weatherEnabled = weatherEnabled,
            onWeatherToggle = onWeatherToggle,
            timeEnabled = timeEnabled,
            onTimeToggle = onTimeToggle
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "平台与人设", trailing = "当前使用配置")
        PlatformPersonaCard(
            enabledPlatforms = enabledPlatforms,
            onTogglePlatform = onTogglePlatform,
            syncPlatform = onSyncPlatform,
            personas = personas,
            activePersonaId = activePersonaId,
            onPersonaChange = onPersonaChange,
            personaVerifyStatus = personaVerifyStatus,
            onVerifyPersona = onVerifyPersona,
            platformSyncStatus = platformSyncStatus
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "位置上下文", trailing = "用于自然聊天")
        LocationCard(
            location = location,
            onLocationSave = onLocationSave,
            locationSaveStatus = locationSaveStatus,
            onSaveLocation = onSaveLocation
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "客户策略", trailing = "白名单优先，黑名单拦截")
        ContactStrategyCard(
            whitelistCount = contactWhitelist.size,
            blacklistCount = contactBlacklist.size,
            onOpenWhitelist = { contactDialog = ContactKind.WHITELIST },
            onOpenBlacklist = { contactDialog = ContactKind.BLACKLIST }
        )

        Spacer(Modifier.height(18.dp))
        SectionHeader(title = "设备与安全", trailing = "运行健康")
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

@Composable
private fun DashboardHeader(
    versionName: String,
    connectionText: String,
    connected: Boolean
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            modifier = Modifier.size(46.dp),
            shape = RoundedCornerShape(15.dp),
            color = SkyText
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.SmartToy,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(23.dp)
                )
            }
        }

        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            Text(
                text = "AI 托管助手",
                color = SkyText,
                fontSize = 19.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "v$versionName · 控制台",
                color = SkyTextMuted,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Surface(
            shape = RoundedCornerShape(999.dp),
            color = SkySurfaceRaised,
            border = BorderStroke(1.dp, SkyLine)
        ) {
            Row(
                Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(if (connected) SkyGreen else SkyWarm)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = connectionText,
                    color = if (connected) SkyTextSecondary else SkyWarm,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun HostingHero(
    isHosting: Boolean,
    engineState: String,
    hostingMode: HostingMode,
    platform: String,
    onToggleHosting: (Boolean) -> Unit
) {
    val subtitle = if (isHosting) {
        DashboardUiPolicy.modeActionText(hostingMode)
    } else {
        "先选择下方托管方式，再开启 AI 托管。"
    }
    val liveState = engineState.takeIf { it.isNotBlank() && it != "IDLE" }
    val buttonNote = when {
        isHosting && liveState != null -> "${platformDisplayName(platform)} · $liveState"
        isHosting -> "${platformDisplayName(platform)} · 正在运行"
        else -> DashboardUiPolicy.modeActionText(hostingMode)
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(22.dp),
        color = if (isHosting) SkyBlueSoft else SkySurfaceRaised,
        border = BorderStroke(
            1.dp,
            if (isHosting) SkyBlue.copy(alpha = 0.45f) else SkyLine
        )
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(
                text = "托管总控",
                color = SkyBlueDeep,
                fontSize = 10.sp,
                fontWeight = FontWeight.Black
            )
            Spacer(Modifier.height(7.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "托管状态",
                        color = SkyText,
                        fontSize = 25.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(7.dp))
                    Text(
                        text = subtitle,
                        color = SkyTextSecondary,
                        fontSize = 12.sp,
                        lineHeight = 18.sp
                    )
                }
                Surface(
                    modifier = Modifier.size(46.dp),
                    shape = RoundedCornerShape(15.dp),
                    color = if (isHosting) SkyBlue else SkySurface,
                    border = BorderStroke(1.dp, if (isHosting) SkyBlue else SkyLine)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.PowerSettingsNew,
                            contentDescription = null,
                            tint = if (isHosting) Color.White else SkyTextMuted,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onToggleHosting(!isHosting) },
                shape = RoundedCornerShape(17.dp),
                color = if (isHosting) SkyBlue else SkySurface,
                border = BorderStroke(
                    1.dp,
                    if (isHosting) SkyBlue else SkyLineStrong
                )
            ) {
                Row(
                    Modifier.padding(horizontal = 15.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = if (isHosting) "已开启 AI 托管" else "请开启 AI 托管",
                            color = if (isHosting) Color.White else SkyText,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = buttonNote,
                            color = if (isHosting) Color.White.copy(alpha = 0.78f) else SkyTextMuted,
                            fontSize = 10.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    SkySwitch(
                        checked = isHosting,
                        onCheckedChange = onToggleHosting,
                        darkBackground = isHosting
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String, trailing: String? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = SkyText,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold
        )
        if (!trailing.isNullOrBlank()) {
            Text(
                text = trailing,
                color = SkyTextMuted,
                fontSize = 10.sp
            )
        }
    }
    Spacer(Modifier.height(9.dp))
}

@Composable
private fun OverviewStats(
    isHosting: Boolean,
    platform: String,
    whitelistCount: Int,
    blacklistCount: Int
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        StatCard(
            value = if (isHosting) "运行" else "待机",
            label = "托管",
            valueColor = if (isHosting) SkyGreen else SkyWarm,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = platformDisplayName(platform),
            label = "当前平台",
            valueColor = SkyBlue,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = whitelistCount.toString(),
            label = "白名单",
            valueColor = SkyCyan,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = blacklistCount.toString(),
            label = "黑名单",
            valueColor = SkyDanger,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun StatCard(
    value: String,
    label: String,
    valueColor: Color,
    modifier: Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(15.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(
            Modifier.padding(horizontal = 5.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = value,
                color = valueColor,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = label,
                color = SkyTextMuted,
                fontSize = 9.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun HostingModeSelector(
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit
) {
    val modes = listOf(
        Triple(HostingMode.FULL_AUTO, "全自动", Icons.Default.Bolt),
        Triple(HostingMode.SEMI_AUTO, "半自动", Icons.Default.EditNote),
        Triple(HostingMode.MONITOR_ONLY, "仅记录", Icons.Default.Visibility)
    )

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(17.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Row(
            Modifier.padding(5.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            modes.forEach { (mode, label, icon) ->
                val selected = hostingMode == mode
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onHostingModeChange(mode) },
                    shape = RoundedCornerShape(13.dp),
                    color = if (selected) SkySurface else Color.Transparent,
                    border = if (selected) BorderStroke(1.dp, SkyBlue.copy(alpha = 0.28f)) else null
                ) {
                    Column(
                        Modifier.padding(vertical = 10.dp, horizontal = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = if (selected) SkyBlue else SkyTextMuted,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.height(5.dp))
                        Text(
                            text = label,
                            color = if (selected) SkyBlue else SkyTextSecondary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            text = when (mode) {
                                HostingMode.FULL_AUTO -> "读、回、发"
                                HostingMode.SEMI_AUTO -> "生成后确认"
                                HostingMode.MONITOR_ONLY -> "只读不操作"
                            },
                            color = SkyTextMuted,
                            fontSize = 9.sp,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickManagement(
    permissions: PermissionStatus,
    context: Context,
    weatherEnabled: Boolean,
    onWeatherToggle: (Boolean) -> Unit,
    timeEnabled: Boolean,
    onTimeToggle: (Boolean) -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column {
            PermissionRow(
                icon = Icons.Default.Smartphone,
                title = "手机设备权限",
                subtitle = "查看应用权限和运行状态",
                granted = permissions.overlay,
                accent = SkyBlue,
                onClick = {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                }
            )
            RowDivider()
            PermissionRow(
                icon = Icons.Default.AccessibilityNew,
                title = "无障碍服务",
                subtitle = "读取聊天页并执行自动操作",
                granted = permissions.accessibility,
                accent = SkyCyan,
                onClick = {
                    context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
            )
            RowDivider()
            PermissionRow(
                icon = Icons.Default.Notifications,
                title = "通知监听",
                subtitle = "作为消息触发的备用来源",
                granted = permissions.notification,
                accent = SkyBlue,
                onClick = {
                    context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }
            )
            RowDivider()
            PermissionRow(
                icon = Icons.Default.BatteryChargingFull,
                title = "电池优化",
                subtitle = "避免后台运行被系统中断",
                granted = permissions.batteryOptimization,
                accent = SkyWarm,
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        context.startActivity(
                            Intent(
                                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:${context.packageName}")
                            )
                        )
                    }
                }
            )
            RowDivider()
            PermissionRow(
                icon = Icons.Default.PictureInPictureAlt,
                title = "悬浮窗权限",
                subtitle = "用于显示托管状态悬浮按钮",
                granted = permissions.overlay,
                accent = SkyGreen,
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        context.startActivity(
                            Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:${context.packageName}")
                            )
                        )
                    }
                }
            )
            RowDivider()
            ToggleRow(
                icon = Icons.Default.Cloud,
                title = "天气感知",
                subtitle = "让回复符合当前天气",
                checked = weatherEnabled,
                accent = SkyBlue,
                onCheckedChange = onWeatherToggle
            )
            RowDivider()
            ToggleRow(
                icon = Icons.Default.Schedule,
                title = "时间感知",
                subtitle = "让回复符合当前作息和时间",
                checked = timeEnabled,
                accent = SkyCyan,
                onCheckedChange = onTimeToggle
            )
        }
    }
}

@Composable
private fun PermissionRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    granted: Boolean,
    accent: Color,
    onClick: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        QuickIcon(icon, accent)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = SkyText,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = subtitle,
                color = SkyTextMuted,
                fontSize = 9.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Text(
            text = if (granted) "已开启" else "去设置",
            color = if (granted) SkyBlue else SkyWarm,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.width(4.dp))
        Icon(
            Icons.Default.ChevronRight,
            contentDescription = null,
            tint = SkyLineStrong,
            modifier = Modifier.size(17.dp)
        )
    }
}

@Composable
private fun ToggleRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    accent: Color,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 13.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        QuickIcon(icon, accent)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = SkyText,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = subtitle,
                color = SkyTextMuted,
                fontSize = 9.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        SkySwitch(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun QuickIcon(icon: ImageVector, accent: Color) {
    Surface(
        modifier = Modifier.size(36.dp),
        shape = RoundedCornerShape(12.dp),
        color = accent.copy(alpha = 0.10f)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

@Composable
private fun RowDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 59.dp)
            .height(1.dp)
            .background(SkyLine)
    )
}

@Composable
private fun PlatformPersonaCard(
    enabledPlatforms: Set<String>,
    onTogglePlatform: (String, Boolean) -> Unit,
    syncPlatform: (String) -> Unit,
    personas: List<PersonaItem>,
    activePersonaId: String,
    onPersonaChange: (String) -> Unit,
    personaVerifyStatus: String,
    onVerifyPersona: () -> Unit,
    platformSyncStatus: String
) {
    val activePersona = personas.firstOrNull { it.id == activePersonaId }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                text = "选择平台",
                color = SkyTextMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(8.dp))
            listOf("soul", "qq", "immomo", "lianxin")
                .chunked(2)
                .forEach { rowPlatforms ->
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(7.dp)
                    ) {
                        rowPlatforms.forEach { platform ->
                            PlatformOption(
                                platform = platform,
                                selected = enabledPlatforms.contains(platform),
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    val enable = !enabledPlatforms.contains(platform)
                                    onTogglePlatform(platform, enable)
                                    if (enable) syncPlatform(platform)
                                }
                            )
                        }
                    }
                    Spacer(Modifier.height(7.dp))
                }
            if (platformSyncStatus.isNotBlank()) {
                Text(
                    text = platformSyncStatus,
                    color = if (platformSyncStatus.startsWith("✓")) SkyGreen else SkyDanger,
                    fontSize = 10.sp
                )
                Spacer(Modifier.height(10.dp))
            }

            Text(
                text = "选择客服",
                color = SkyTextMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                PersonaSelector(
                    personas = personas,
                    activePersona = activePersona,
                    modifier = Modifier.weight(1f),
                    onSelect = onPersonaChange
                )
                Spacer(Modifier.width(8.dp))
                SkySmallAction(
                    label = "同步",
                    status = personaVerifyStatus,
                    onClick = onVerifyPersona
                )
            }
            if (personaVerifyStatus.isNotBlank()) {
                Spacer(Modifier.height(7.dp))
                Text(
                    text = personaVerifyStatus,
                    color = if (personaVerifyStatus.startsWith("✓")) SkyGreen else SkyDanger,
                    fontSize = 10.sp
                )
            }
        }
    }
}

@Composable
private fun PlatformOption(
    platform: String,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit
) {
    Surface(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(13.dp),
        color = if (selected) SkyBlueSoft else SkySurface,
        border = BorderStroke(1.dp, if (selected) SkyBlue else SkyLine)
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(30.dp),
                shape = RoundedCornerShape(10.dp),
                color = if (selected) SkyText else SkyBlueSoft
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = platformDisplayName(platform).take(1),
                        color = if (selected) Color.White else SkyBlue,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Black
                    )
                }
            }
            Spacer(Modifier.width(7.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = platformDisplayName(platform),
                    color = SkyText,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = if (selected) "已选择" else "点击选择",
                    color = if (selected) SkyGreen else SkyTextMuted,
                    fontSize = 8.sp
                )
            }
            if (selected) {
                Box(
                    Modifier
                        .size(17.dp)
                        .clip(CircleShape)
                        .background(SkyBlue),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "✓",
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Black
                    )
                }
            }
        }
    }
}

@Composable
private fun PersonaSelector(
    personas: List<PersonaItem>,
    activePersona: PersonaItem?,
    modifier: Modifier,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val personaName = activePersona?.let(PersonaPresentation::name) ?: "未选择"
    val avatar = activePersona?.let(PersonaPresentation::avatarLabel) ?: "客"
    val role = activePersona?.let(PersonaPresentation::roleDetail) ?: "等待同步"

    Box(modifier) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true },
            shape = RoundedCornerShape(16.dp),
            color = SkySurface,
            border = BorderStroke(1.dp, SkyLineStrong)
        ) {
            Row(
                Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(4.dp)
                        .height(48.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(SkyBlue)
                )
                Spacer(Modifier.width(9.dp))
                Surface(
                    modifier = Modifier.size(42.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = SkyBlue
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = avatar,
                            color = Color.White,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "当前客服",
                        color = SkyBlueDeep,
                        fontSize = 8.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        text = personaName,
                        color = SkyText,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${activePersona?.let(PersonaPresentation::genderLabel) ?: "客服"} · $role",
                        color = SkyTextMuted,
                        fontSize = 9.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(
                    Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = SkyBlue,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(min = 44.dp)
        ) {
            if (personas.isEmpty()) {
                DropdownMenuItem(
                    text = { Text("暂无人设，请检查后端连接", fontSize = 13.sp) },
                    onClick = { expanded = false }
                )
            } else {
                personas.forEach { persona ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(
                                    text = PersonaPresentation.displayName(persona),
                                    color = SkyText,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = PersonaPresentation.roleDetail(persona),
                                    color = SkyTextMuted,
                                    fontSize = 10.sp
                                )
                            }
                        },
                        onClick = {
                            onSelect(persona.id)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun SkySmallAction(
    label: String,
    status: String,
    onClick: () -> Unit
) {
    val succeeded = status.startsWith("✓")
    val failed = status.startsWith("✗")
    val color = when {
        succeeded -> SkyGreen
        failed -> SkyDanger
        else -> SkyBlue
    }
    Surface(
        modifier = Modifier.clickable(enabled = !succeeded, onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = when {
            succeeded -> SkyGreenSoft
            failed -> SkyDangerSoft
            else -> SkySurface
        },
        border = BorderStroke(1.dp, color.copy(alpha = 0.65f))
    ) {
        Text(
            text = if (succeeded) "已同步" else label,
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 10.dp),
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun LocationCard(
    location: UserLocationEntity,
    onLocationSave: (String, String, String, String) -> Unit,
    locationSaveStatus: String,
    onSaveLocation: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(14.dp)) {
            AddressField(
                icon = Icons.Default.Home,
                label = "家庭地址",
                value = "${location.homeCity} ${location.homeDistrict}".trim(),
                placeholder = "例如：重庆 两江新区",
                onValueChange = { value ->
                    val parts = value.trim().split(Regex("\\s+"), limit = 2)
                    onLocationSave(
                        parts.getOrElse(0) { "" },
                        parts.getOrElse(1) { "" },
                        location.workCity,
                        location.workDistrict
                    )
                }
            )
            Spacer(Modifier.height(12.dp))
            AddressField(
                icon = Icons.Default.Work,
                label = "工作地址",
                value = "${location.workCity} ${location.workDistrict}".trim(),
                placeholder = "例如：重庆 两江新区",
                onValueChange = { value ->
                    val parts = value.trim().split(Regex("\\s+"), limit = 2)
                    onLocationSave(
                        location.homeCity,
                        location.homeDistrict,
                        parts.getOrElse(0) { "" },
                        parts.getOrElse(1) { "" }
                    )
                }
            )
            Spacer(Modifier.height(13.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onSaveLocation),
                shape = RoundedCornerShape(12.dp),
                color = SkyBlue
            ) {
                Row(
                    Modifier.padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Layers,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(15.dp)
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(
                        text = if (locationSaveStatus.startsWith("✓")) "地址已保存" else "保存地址",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            if (locationSaveStatus.isNotBlank()) {
                Spacer(Modifier.height(7.dp))
                Text(
                    text = locationSaveStatus,
                    color = if (locationSaveStatus.startsWith("✓")) SkyGreen else SkyDanger,
                    fontSize = 10.sp
                )
            }
        }
    }
}

@Composable
private fun AddressField(
    icon: ImageVector,
    label: String,
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit
) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                icon,
                contentDescription = null,
                tint = SkyBlue,
                modifier = Modifier.size(15.dp)
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = label,
                color = SkyTextSecondary,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold
            )
        }
        Spacer(Modifier.height(6.dp))
        StyledTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = placeholder,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun ContactStrategyCard(
    whitelistCount: Int,
    blacklistCount: Int,
    onOpenWhitelist: () -> Unit,
    onOpenBlacklist: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Row(
            Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            ContactListButton(
                title = "白名单",
                count = whitelistCount,
                color = SkyGreen,
                modifier = Modifier.weight(1f),
                onClick = onOpenWhitelist
            )
            ContactListButton(
                title = "黑名单",
                count = blacklistCount,
                color = SkyDanger,
                modifier = Modifier.weight(1f),
                onClick = onOpenBlacklist
            )
        }
    }
}

@Composable
private fun ContactListButton(
    title: String,
    count: Int,
    color: Color,
    modifier: Modifier,
    onClick: () -> Unit
) {
    Surface(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(13.dp),
        color = color.copy(alpha = 0.08f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.45f))
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = color,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = "$count 位联系人",
                    color = SkyTextMuted,
                    fontSize = 9.sp
                )
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(17.dp)
            )
        }
    }
}

@Composable
private fun ContactManagementDialog(
    title: String,
    emptyText: String,
    contacts: List<String>,
    accent: Color,
    onDismiss: () -> Unit,
    onChange: (List<String>) -> Unit
) {
    var newContact by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StyledTextField(
                        value = newContact,
                        onValueChange = { newContact = it },
                        placeholder = "输入联系人或关键词",
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    TextButton(
                        onClick = {
                            val normalized = newContact.trim()
                            if (normalized.isNotEmpty() && normalized !in contacts) {
                                onChange(contacts + normalized)
                            }
                            newContact = ""
                        }
                    ) {
                        Text("添加", color = accent, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(10.dp))
                if (contacts.isEmpty()) {
                    Text(emptyText, color = SkyTextMuted, fontSize = 13.sp)
                } else {
                    Column(
                        Modifier
                            .heightIn(max = 280.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        contacts.forEach { contact ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = contact,
                                    modifier = Modifier.weight(1f),
                                    color = SkyText,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                TextButton(onClick = { onChange(contacts - contact) }) {
                                    Text("删除", color = SkyDanger, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("完成", color = SkyBlue, fontWeight = FontWeight.Bold)
            }
        }
    )
}

@Composable
private fun DeviceSecurityCard(
    token: String,
    onTokenChange: (String) -> Unit,
    tokenVerifyStatus: String,
    onVerifyToken: () -> Unit,
    grantedPermissions: Int
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "$grantedPermissions / 4 权限正常",
                        color = SkyText,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = "无障碍、通知、电池和悬浮窗状态",
                        color = SkyTextMuted,
                        fontSize = 9.sp
                    )
                }
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (grantedPermissions == 4) SkyGreenSoft else SkyWarmSoft
                ) {
                    Text(
                        text = if (grantedPermissions == 4) "健康" else "待完善",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        color = if (grantedPermissions == 4) SkyGreen else SkyWarm,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(Modifier.height(13.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Key,
                    contentDescription = null,
                    tint = SkyBlue,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = "设备钥匙",
                    modifier = Modifier.weight(1f),
                    color = SkyTextSecondary,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = tokenVerifyStatus.ifBlank { "未验证" },
                    color = if (tokenVerifyStatus.startsWith("✓")) SkyGreen else SkyTextMuted,
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.height(7.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                StyledTextField(
                    value = token,
                    onValueChange = onTokenChange,
                    placeholder = "输入设备钥匙",
                    monospace = true,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    modifier = Modifier.clickable(onClick = onVerifyToken),
                    shape = RoundedCornerShape(12.dp),
                    color = SkyBlue
                ) {
                    Text(
                        text = "验证",
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        color = Color.White,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}

@Composable
private fun StyledTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier,
    monospace: Boolean = false
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = SkySurface,
        border = BorderStroke(1.dp, SkyLineStrong)
    ) {
        Box(Modifier.padding(horizontal = 11.dp, vertical = 11.dp)) {
            if (value.isEmpty()) {
                Text(
                    text = placeholder,
                    color = SkyTextMuted,
                    fontSize = if (monospace) 11.sp else 12.sp,
                    fontFamily = if (monospace) FontFamily.Monospace else FontFamily.SansSerif
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = TextStyle(
                    color = SkyText,
                    fontSize = if (monospace) 11.sp else 12.sp,
                    fontFamily = if (monospace) FontFamily.Monospace else FontFamily.SansSerif
                ),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun SkySwitch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    darkBackground: Boolean = false
) {
    val trackColor by animateColorAsState(
        targetValue = if (checked) {
            if (darkBackground) Color.White.copy(alpha = 0.28f) else SkyBlue
        } else {
            SkyLineStrong
        },
        animationSpec = tween(180),
        label = "track"
    )
    val thumbOffset by animateDpAsState(
        targetValue = if (checked) 20.dp else 2.dp,
        animationSpec = tween(180),
        label = "thumb"
    )
    val clickableModifier = if (onCheckedChange == null) {
        Modifier
    } else {
        Modifier.clickable { onCheckedChange(!checked) }
    }

    Box(
        modifier = Modifier
            .then(clickableModifier)
            .width(46.dp)
            .height(26.dp)
            .clip(CircleShape)
            .background(trackColor),
        contentAlignment = Alignment.CenterStart
    ) {
        Box(
            Modifier
                .offset(x = thumbOffset)
                .size(20.dp)
                .clip(CircleShape)
                .background(Color.White)
        )
    }
}
