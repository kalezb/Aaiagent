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

data class PersonaFactsUiState(
    val ageMode: String = "fixed_age",
    val fixedAge: String = "29",
    val birthYear: String = "",
    val maritalStatus: String = "married",
    val hasChildren: Boolean = false,
    val childrenAge: String = "",
    val contactQq: String = "",
    val hometown: String = "重庆",
    val currentCity: String = "重庆",
    val currentDistrict: String = "两江新区",
    val commonArea: String = "",
    val workCity: String = "重庆",
    val workDistrict: String = "江北区",
    val locationPrecision: String = "district",
    val proactiveLocationAllowed: Boolean = false,
    val configVersion: Long = 0L
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
    voiceTestStatus: String,
    onVoiceTest: () -> Unit,
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
            voiceTestStatus = voiceTestStatus,
            onVoiceTest = onVoiceTest,
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

@Composable
private fun DashboardHeader(
    versionName: String,
    connectionText: String,
    connectionTone: ConnectionTone
) {
    val toneColor = when (connectionTone) {
        ConnectionTone.GREEN -> SkyGreen
        ConnectionTone.YELLOW -> SkyWarm
        ConnectionTone.RED -> SkyDanger
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Image(
            painter = painterResource(R.drawable.ic_brand_mark),
            contentDescription = "AI 托管助手",
            modifier = Modifier.size(50.dp)
        )

        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            Text(
                text = "AI 托管助手",
                color = SkyText,
                fontSize = 23.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "v$versionName · 控制台",
                color = SkyTextMuted,
                fontSize = 12.sp,
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
                        .background(toneColor)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = connectionText,
                    color = if (connectionTone == ConnectionTone.GREEN) SkyTextSecondary else toneColor,
                    fontSize = 12.sp,
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
    platform: String,
    onToggleHosting: (Boolean) -> Unit
) {
    val subtitle = if (isHosting) {
        "${platformDisplayName(platform)} · ${engineState.takeIf { it.isNotBlank() && it != "IDLE" } ?: "正在运行"}"
    } else {
        "选择托管方式后开启"
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
                text = "AI 托管",
                color = SkyBlueDeep,
                fontSize = 12.sp,
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
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(7.dp))
                    Text(
                        text = subtitle,
                        color = SkyTextSecondary,
                        fontSize = 15.sp,
                        lineHeight = 21.sp
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
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
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
private fun SectionHeader(title: String) {
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
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold
        )
    }
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun IncidentFeedbackCard(
    apiBase: String,
    token: String,
) {
    val scope = rememberCoroutineScope()
    var status by remember {
        mutableStateOf("问题反馈会打包最近一段运行过程；页面采样请切到目标平台后长按悬浮窗")
    }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = "刚才有问题",
                color = SkyText,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = status,
                color = SkyTextSecondary,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )
            Spacer(Modifier.height(13.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        val exported = AutomationTrace.markUserFeedback("手机端手动反馈")
                        if (exported == null) {
                            status = "暂时没有可导出的运行记录"
                            return@clickable
                        }
                        status = "已保存：${exported.name}，正在上传..."
                        if (token.isBlank()) {
                            status = "已保存：${exported.name}；设备密钥为空，稍后可重试"
                            return@clickable
                        }
                        scope.launch {
                            val uploaded = withContext(Dispatchers.IO) {
                                ApiService(apiBase).uploadAutomationIncident(token, exported)
                            }
                            status = if (uploaded) {
                                "已上传，AI可以读取完整时间线"
                            } else {
                                "已保存在手机；上传失败，可再次点击重试"
                            }
                        }
                    },
                shape = RoundedCornerShape(13.dp),
                color = SkyBlueSoft,
                border = BorderStroke(1.dp, SkyBlue.copy(alpha = 0.35f))
            ) {
                Box(
                    Modifier.padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "记录这次问题",
                        color = SkyBlueDeep,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
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
                fontSize = 21.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = label,
                color = SkyTextMuted,
                fontSize = 12.sp,
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
        Triple(HostingMode.FULL_AUTO, DashboardUiPolicy.hostingModeLabel(HostingMode.FULL_AUTO), Icons.Default.Bolt),
        Triple(HostingMode.SEMI_AUTO, DashboardUiPolicy.hostingModeLabel(HostingMode.SEMI_AUTO), Icons.Default.EditNote),
        Triple(HostingMode.MONITOR_ONLY, DashboardUiPolicy.hostingModeLabel(HostingMode.MONITOR_ONLY), Icons.Default.Visibility)
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
                        Modifier.padding(vertical = 13.dp, horizontal = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = if (selected) SkyBlue else SkyTextMuted,
                            modifier = Modifier.size(21.dp)
                        )
                        Spacer(Modifier.height(5.dp))
                        Text(
                            text = label,
                            color = if (selected) SkyBlue else SkyTextSecondary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
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
    onTimeToggle: (Boolean) -> Unit,
    lineA: Boolean,
    onLineChange: (Boolean) -> Unit,
    lineHealthA: ModelLineHealthState,
    lineHealthB: ModelLineHealthState,
    lineHealthMessage: String
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
                icon = Icons.Default.AccessibilityNew,
                title = "无障碍服务",
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
                checked = weatherEnabled,
                accent = SkyBlue,
                onCheckedChange = onWeatherToggle
            )
            RowDivider()
            ToggleRow(
                icon = Icons.Default.Schedule,
                title = "时间感知",
                checked = timeEnabled,
                accent = SkyCyan,
                onCheckedChange = onTimeToggle
            )
            RowDivider()
            LineSwitchRow(
                lineA = lineA,
                onLineChange = onLineChange,
                healthA = lineHealthA,
                healthB = lineHealthB,
                statusMessage = lineHealthMessage
            )
        }
    }
}

@Composable
private fun ToggleRow(
    icon: ImageVector,
    title: String,
    checked: Boolean,
    accent: Color,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        QuickIcon(icon, accent)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = SkyText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
        }
        SkySwitch(checked = checked, onCheckedChange = null)
    }
}

@Composable
internal fun QuickIcon(icon: ImageVector, accent: Color) {    Surface(
        modifier = Modifier.size(40.dp),
        shape = RoundedCornerShape(12.dp),
        color = accent.copy(alpha = 0.10f)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
private fun RowDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 64.dp)            .height(1.dp)
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
    platformSyncStatus: String,
    voiceTestStatus: String,
    onVoiceTest: () -> Unit,
    voiceReplyEnabled: Boolean,
    onVoiceReplyToggle: (Boolean) -> Unit,
    voiceOutputMode: String,
    onVoiceOutputChange: (String) -> Unit,
    selfNickname: String,
    onSelfNicknameChange: (String) -> Unit
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
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(8.dp))
            listOf("soul", "qq", "douban", "lianxin")
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
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(10.dp))
            }

            Text(
                text = "选择客服",
                color = SkyTextMuted,
                fontSize = 12.sp,
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
                    label = "应用",
                    status = personaVerifyStatus,
                    onClick = onVerifyPersona
                )
            }
            if (personaVerifyStatus.isNotBlank()) {
                Spacer(Modifier.height(7.dp))
                Text(
                    text = personaVerifyStatus,
                    color = if (personaVerifyStatus.startsWith("✓")) SkyGreen else SkyDanger,
                    fontSize = 12.sp
                )
            }
            Spacer(Modifier.height(12.dp))
            RowDivider()
            Spacer(Modifier.height(12.dp))
            ToggleRow(
                icon = Icons.Default.Mic,
                title = "语音回复",
                checked = voiceReplyEnabled,
                accent = SkyGreen,
                onCheckedChange = onVoiceReplyToggle
            )
            RowDivider()
            VoiceOutputRow(
                mode = voiceOutputMode,
                onModeChange = onVoiceOutputChange
            )
            RowDivider()
            VoiceSendTestRow(
                status = voiceTestStatus,
                mode = voiceOutputMode,
                onTest = onVoiceTest
            )
            RowDivider()
            SelfNicknameRow(
                value = selfNickname,
                onValueChange = onSelfNicknameChange
            )
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
            Modifier.padding(horizontal = 10.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(36.dp),
                shape = RoundedCornerShape(10.dp),
                color = if (selected) SkyText else SkyBlueSoft
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = platformDisplayName(platform).take(1),
                        color = if (selected) Color.White else SkyBlue,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Black
                    )
                }
            }
            Spacer(Modifier.width(7.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = platformDisplayName(platform),
                    color = SkyText,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            if (selected) {
                Box(
                    Modifier
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(SkyBlue),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "✓",
                        color = Color.White,
                        fontSize = 12.sp,
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
                Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(4.dp)
                        .height(54.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(SkyBlue)
                )
                Spacer(Modifier.width(9.dp))
                Surface(
                    modifier = Modifier.size(46.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = SkyBlue
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = avatar,
                            color = Color.White,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "当前客服",
                        color = SkyBlueDeep,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        text = personaName,
                        color = SkyText,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${activePersona?.let(PersonaPresentation::genderLabel) ?: "客服"} · $role",
                        color = SkyTextMuted,
                        fontSize = 12.sp,
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
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = PersonaPresentation.roleDetail(persona),
                                    color = SkyTextMuted,
                                    fontSize = 12.sp
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
            text = if (succeeded) "已应用" else label,
            modifier = Modifier.padding(horizontal = 13.dp, vertical = 12.dp),
            color = color,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * 语音发送测试入口。
 *
 * 第 1 步的真机验证用：按之前先停在目标联系人的 Soul 聊天页，点一下就会让 AiaAgent
 * 自己走完"点录音 → 暂停 → 发语音"。此刻录进去的还是真实环境音，
 * 等配音和麦克风注入接上以后，才会变成你自己的声音。
 */
@Composable
private fun VoiceSendTestRow(
    status: String,
    mode: String,
    onTest: () -> Unit
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                text = "语音发送测试",
                color = SkyText,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = when (mode) {
                    VoiceOutputMode.INJECT -> "注入模式需要 root + LSPosed；点右边按钮测试发送。"
                    VoiceOutputMode.SPEAKER -> "外放模式不需要 root；点右边按钮测试发送。"
                    else -> "自动模式会优先注入，没 root 就改用外放；点右边按钮测试发送。"
                },
                color = SkyTextMuted,
                fontSize = 11.sp
            )
        }
        Spacer(Modifier.width(8.dp))
        Surface(
            modifier = Modifier.clickable(onClick = onTest),
            shape = RoundedCornerShape(12.dp),
            color = SkySurface,
            border = BorderStroke(1.dp, SkyBlue.copy(alpha = 0.65f))
        ) {
            Text(
                text = "测试发送",
                modifier = Modifier.padding(horizontal = 13.dp, vertical = 12.dp),
                color = SkyBlue,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
    if (status.isNotBlank()) {
        Spacer(Modifier.height(7.dp))
        Text(
            text = status,
            color = when {
                status.startsWith("✓") -> SkyGreen
                status.startsWith("✗") -> SkyDanger
                else -> SkyTextMuted
            },
            fontSize = 12.sp
        )
    }
}

@Composable
private fun ChoiceChips(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        options.forEach { (value, label) ->
            val active = value == selected
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(value) },
                shape = RoundedCornerShape(11.dp),
                color = if (active) SkyBlueSoft else SkySurface,
                border = BorderStroke(1.dp, if (active) SkyBlue else SkyLine)
            ) {
                Text(
                    text = label,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 10.dp),
                    color = if (active) SkyBlueDeep else SkyTextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
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
                fontSize = 13.sp,
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
internal fun StyledTextField(
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
                    fontSize = if (monospace) 13.sp else 14.sp,
                    fontFamily = if (monospace) FontFamily.Monospace else FontFamily.SansSerif
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = TextStyle(
                    color = SkyText,
                    fontSize = if (monospace) 13.sp else 14.sp,
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

@Composable
private fun modelLineHealthColor(state: ModelLineHealthState): Color = when (state) {
    ModelLineHealthState.CONNECTED -> SkyGreen
    ModelLineHealthState.FAILED -> SkyDanger
    ModelLineHealthState.CHECKING,
    ModelLineHealthState.UNKNOWN -> SkyWarm
}

@Composable
private fun LineSwitchRow(
    lineA: Boolean,
    onLineChange: (Boolean) -> Unit,
    healthA: ModelLineHealthState,
    healthB: ModelLineHealthState,
    statusMessage: String
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.SwapHoriz,
                contentDescription = null,
                tint = SkyCyan,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "线路切换",
                color = SkyText,
                fontSize = 15.sp,
                modifier = Modifier.weight(1f)
            )
            listOf(
                Triple(true, "线路A", healthA),
                Triple(false, "线路B", healthB)
            ).forEach { (value, label, health) ->
                val selected = lineA == value
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = if (selected) SkyBlue else SkySurface,
                    border = BorderStroke(1.dp, if (selected) SkyBlue else SkyLineStrong),
                    modifier = Modifier
                        .padding(start = 6.dp)
                        .clickable { onLineChange(value) }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(modelLineHealthColor(health))
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = label,
                            color = if (selected) Color.White else SkyTextMuted,
                            fontSize = 13.sp
                        )
                    }
                }
            }
        }
        if (statusMessage.isNotBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = statusMessage,
                color = when {
                    statusMessage.startsWith("✓") -> SkyGreen
                    statusMessage.startsWith("✗") -> SkyDanger
                    else -> SkyWarm
                },
                fontSize = 12.sp
            )
        }
    }
}
