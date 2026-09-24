package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.theme.*

// ── Types ──

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

fun checkPermissionStatus(context: Context): PermissionStatus {
    val acc = try { Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)?.contains(context.packageName) == true } catch (_: Exception) { false }
    val notif = try { Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true } catch (_: Exception) { false }
    val battery = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager; pm.isIgnoringBatteryOptimizations(context.packageName) } else true
    val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true
    return PermissionStatus(acc, notif, battery, overlay)
}

fun platformDisplayName(p: String) = when (p) { "soul" -> "Soul"; "qq" -> "QQ"; "immomo" -> "陌陌"; "lianxin" -> "连信"; else -> p }

// ══════════════════════ DASHBOARD ══════════════════════

@Composable
fun DashboardScreen(
    isHosting: Boolean,
    engineState: String,
    lastReply: String?,
    platformsStatus: Map<String, Boolean>,
    enabledPlatforms: Set<String>,
    onTogglePlatform: (String, Boolean) -> Unit,
    personas: List<PersonaItem>,
    activePersonaId: String,
    onPersonaChange: (String) -> Unit,
    token: String,
    apiBase: String,
    onTokenChange: (String) -> Unit,
    onApiBaseChange: (String) -> Unit,
    location: UserLocationEntity,
    onLocationSave: (String, String, String, String) -> Unit,
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit,
    onToggleHosting: (Boolean) -> Unit,
    // 验证状态
    personaVerifyStatus: String,
    onVerifyPersona: () -> Unit,
    locationSaveStatus: String,
    onSaveLocation: () -> Unit,
    tokenVerifyStatus: String,
    onVerifyToken: () -> Unit,
    platformSyncStatus: String,
    onSyncPlatform: (String) -> Unit,
    // 天气/时间感知
    weatherEnabled: Boolean,
    onWeatherToggle: (Boolean) -> Unit,
    timeEnabled: Boolean,
    onTimeToggle: (Boolean) -> Unit,
    // 白黑名单
    onOpenWhitelist: () -> Unit,
    onOpenBlacklist: () -> Unit,
    // 发送方式
    sendMode: String,
    onSendModeChange: (String) -> Unit
) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val versionName = remember(ctx) {
        runCatching {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
        }.getOrNull() ?: "unknown"
    }
    var perms by remember { mutableStateOf(checkPermissionStatus(ctx)) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) perms = checkPermissionStatus(ctx)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(
        Modifier.fillMaxSize().background(Bg).verticalScroll(rememberScrollState()).padding(top = 12.dp, bottom = 32.dp)
    ) {
        // 标题栏
        Text(text = "AI 托管助手", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            fontSize = 22.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        Text(text = "v$versionName · Soul · DeepSeek", modifier = Modifier.padding(horizontal = 20.dp),
            fontSize = 11.sp, color = TextSecondary)

        Spacer(Modifier.height(12.dp))

        // ═══ 卡片1: 设备权限 ═══
        Card1Permissions(perms, ctx)

        Spacer(Modifier.height(12.dp))

        // ═══ 卡片2: 平台与人设 ═══
        Card2PlatformPersona(
            enabledPlatforms, onTogglePlatform, platformSyncStatus, onSyncPlatform,
            personas, activePersonaId, onPersonaChange, personaVerifyStatus, onVerifyPersona,
            location, onLocationSave, locationSaveStatus, onSaveLocation
        )

        Spacer(Modifier.height(12.dp))

        // ═══ 卡片3: AI 托管控制 ═══
        Card3HostingControl(
            isHosting, engineState, hostingMode, onHostingModeChange, onToggleHosting,
            sendMode, onSendModeChange, onOpenWhitelist, onOpenBlacklist
        )

        Spacer(Modifier.height(12.dp))

        // ═══ 卡片4: 设置 ═══
        Card4Settings(
            token, onTokenChange, tokenVerifyStatus, onVerifyToken,
            weatherEnabled, onWeatherToggle, timeEnabled, onTimeToggle
        )

        Spacer(Modifier.height(16.dp))
        Text(text = "AI 托管助手 v$versionName · 基于 DeepSeek Chat", modifier = Modifier.padding(horizontal = 20.dp), fontSize = 11.sp, color = TextHint)
    }
}

// ══════════════════════ 卡片1: 设备权限 ══════════════════════

@Composable
private fun Card1Permissions(perms: PermissionStatus, ctx: Context) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(text = "🔒 设备权限", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(14.dp))
            PermItem("无障碍读取与操作", perms.accessibility) { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            PermItem("通知读取", perms.notification) { ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
            PermItem("电池优化白名单", perms.batteryOptimization) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    i.data = Uri.parse("package:" + ctx.packageName)
                    ctx.startActivity(i)
                }
            }
        }
    }
}

@Composable
private fun PermItem(title: String, granted: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp).clickable(enabled = !granted, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, Modifier.weight(1f), fontSize = 15.sp, color = TextPrimary)
        Surface(
            shape = RoundedCornerShape(6.dp),
            color = if (granted) GreenLight else Color.Transparent,
            border = if (granted) null else BorderStroke(1.5.dp, Green)
        ) {
            Text(
                if (granted) "已授权 ✓" else "去设置 →",
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                fontSize = 13.sp, fontWeight = FontWeight.Medium,
                color = if (granted) Green else Green
            )
        }
    }
}

// ══════════════════════ 卡片2: 平台与人设 ══════════════════════

@Composable
private fun Card2PlatformPersona(
    enabledPlatforms: Set<String>, onTogglePlatform: (String, Boolean) -> Unit,
    platformSyncStatus: String, onSyncPlatform: (String) -> Unit,
    personas: List<PersonaItem>, activePersonaId: String, onPersonaChange: (String) -> Unit,
    personaVerifyStatus: String, onVerifyPersona: () -> Unit,
    location: UserLocationEntity, onLocationSave: (String, String, String, String) -> Unit,
    locationSaveStatus: String, onSaveLocation: () -> Unit
) {
    val active = personas.find { it.id == activePersonaId }
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(text = "🧠 平台与人设", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(14.dp))

            // 平台选择
            Text(text = "平台选择", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("soul", "qq", "immomo", "lianxin").forEach { p ->
                    val sel = enabledPlatforms.contains(p)
                    val label = platformDisplayName(p)
                    Surface(
                        Modifier.weight(1f).clickable {
                            onTogglePlatform(p, !sel)
                            onSyncPlatform(p)
                        },
                        RoundedCornerShape(20.dp),
                        color = if (sel) Green else GrayBg,
                        border = if (sel) null else BorderStroke(1.dp, Gray)
                    ) {
                        Text(text = label, modifier = Modifier.padding(vertical = 10.dp).fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                            color = if (sel) White else TextSecondary)
                    }
                }
            }
            if (platformSyncStatus.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Text(platformSyncStatus, fontSize = 11.sp, color = if (platformSyncStatus.startsWith("✓")) Green else Red)
            }

            Spacer(Modifier.height(16.dp))

            // 客服人设
            Text(text = "客服人设", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Persona dropdown
                var exp by remember { mutableStateOf(false) }
                Box(Modifier.weight(1f)) {
                    Surface(
                        Modifier.fillMaxWidth().clickable { exp = true },
                        RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, Divider)
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(active?.let { PersonaPresentation.displayName(it) } ?: "未选择", Modifier.weight(1f), fontSize = 14.sp, color = TextPrimary)
                            Text(text = "▼", fontSize = 10.sp, color = TextSecondary)
                        }
                    }
                    DropdownMenu(expanded = exp, onDismissRequest = { exp = false }) {
                        personas.forEach { p ->
                            DropdownMenuItem(
                                text = { Text(PersonaPresentation.displayName(p), fontSize = 14.sp) },
                                onClick = { onPersonaChange(p.id); exp = false }
                            )
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                VerifyButton(
                    label = "确认切换",
                    status = personaVerifyStatus,
                    onClick = onVerifyPersona
                )
            }

            Spacer(Modifier.height(16.dp))

            // 位置设置
            Text(text = "位置设置", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Text(text = "🏠 家庭地址", fontSize = 14.sp, color = TextPrimary)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LocField(location.homeCity, { onLocationSave(it, location.homeDistrict, location.workCity, location.workDistrict) }, "城市", Modifier.weight(1f))
                LocField(location.homeDistrict, { onLocationSave(location.homeCity, it, location.workCity, location.workDistrict) }, "区域", Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Text(text = "💼 工作地址", fontSize = 14.sp, color = TextPrimary)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LocField(location.workCity, { onLocationSave(location.homeCity, location.homeDistrict, it, location.workDistrict) }, "城市", Modifier.weight(1f))
                LocField(location.workDistrict, { onLocationSave(location.homeCity, location.homeDistrict, location.workCity, it) }, "区域", Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                SaveButton("确认保存", locationSaveStatus, onSaveLocation, Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            // Current status
            Surface(Modifier.fillMaxWidth(), RoundedCornerShape(8.dp), color = GreenLight) {
                Text(
                    "当前：${platformDisplayName(enabledPlatforms.firstOrNull() ?: "soul")} | ${active?.let { PersonaPresentation.displayName(it) } ?: "未选择"}\n家：${location.homeCity}${location.homeDistrict} | 班：${location.workCity}${location.workDistrict}",
                    Modifier.padding(10.dp), fontSize = 12.sp, color = TextPrimary, lineHeight = 18.sp
                )
            }
        }
    }
}

@Composable
private fun LocField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier) {
    Surface(modifier, RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Divider)) {
        Box(Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) {
            if (value.isEmpty()) Text(placeholder, color = TextHint, fontSize = 13.sp)
            BasicTextField(value = value, onValueChange = onChange, textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp), singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun VerifyButton(label: String, status: String, onClick: () -> Unit) {
    val isSuccess = status.startsWith("✓")
    val isFail = status.startsWith("✗")
    val bg = when { isSuccess -> GreenLight; isFail -> RedLight; else -> Color.Transparent }
    val border = when { isSuccess -> Green; isFail -> Red; else -> Green }
    val txt = when { isSuccess -> "✓ ${label.removeSuffix("验证")}已同步"; isFail -> "✗ 同步失败"; else -> label }
    val txtColor = when { isSuccess -> Green; isFail -> Red; else -> Green }
    Surface(
        Modifier.clickable(enabled = !isSuccess) { onClick() },
        RoundedCornerShape(8.dp), color = bg,
        border = BorderStroke(1.5.dp, border)
    ) {
        Text(txt, Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            fontSize = 13.sp, fontWeight = FontWeight.Medium, color = txtColor)
    }
}

@Composable
private fun SaveButton(label: String, status: String, onClick: () -> Unit, modifier: Modifier) {
    val isSuccess = status.startsWith("✓")
    val txt = when { isSuccess -> "✓ ${label.removePrefix("保存")}已保存"; status.isNotEmpty() && !isSuccess -> "✗ 保存失败"; else -> label }
    Button(
        onClick = onClick, modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = if (isSuccess) GreenLight else Green),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 0.dp)
    ) {
        Text(txt, color = if (isSuccess) Green else White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

// ══════════════════════ 卡片3: AI 托管控制 ══════════════════════

// ══════════════════════ 卡片3: AI 托管控制 ══════════════════════


@Composable
private fun Card3HostingControl(
    isHosting: Boolean, engineState: String,
    hostingMode: HostingMode, onHostingModeChange: (HostingMode) -> Unit,
    onToggleHosting: (Boolean) -> Unit,
    sendMode: String, onSendModeChange: (String) -> Unit,
    onOpenWhitelist: () -> Unit, onOpenBlacklist: () -> Unit
) {
    // 白名单管理弹窗
    var showWhitelist by remember { mutableStateOf(false) }
    var showBlacklist by remember { mutableStateOf(false) }
    var newContact by remember { mutableStateOf("") }
    var whitelist by remember { mutableStateOf(listOf<String>()) }
    var blacklist by remember { mutableStateOf(listOf<String>()) }

    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(text = "⚡ AI 托管控制", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(14.dp))

            // 托管模式选择（始终可见，开启托管前先选模式）
            Text(text = "托管模式", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    HostingMode.FULL_AUTO to "🤖 全自动",
                    HostingMode.SEMI_AUTO to "✍️ 半自动",
                    HostingMode.MONITOR_ONLY to "📋 仅记录"
                ).forEach { (mode, label) ->
                    val sel = hostingMode == mode
                    Surface(
                        Modifier.weight(1f).clickable { onHostingModeChange(mode) },
                        RoundedCornerShape(10.dp),
                        color = if (sel) GreenLight else White,
                        border = BorderStroke(1.5.dp, if (sel) Green else Gray)
                    ) {
                        Column(Modifier.padding(vertical = 8.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(text = label, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                color = if (sel) Green else TextSecondary)
                            Text(text = when (mode) {
                                HostingMode.FULL_AUTO -> "自动读+回+发"
                                HostingMode.SEMI_AUTO -> "生成回复填框"
                                HostingMode.MONITOR_ONLY -> "仅同步聊天记录"
                            }, fontSize = 9.sp, color = TextHint)
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Divider(color = Divider, thickness = 1.dp)
            Spacer(Modifier.height(14.dp))

                        // AI???????????
            val btnBg = if (isHosting) Green else Color(0xFF555555)
            val btnText = if (isHosting) "\u2713 \u5df2\u5f00\u542fAI\u6258\u7ba1" else "\u8bf7\u5f00\u542fAI\u6258\u7ba1"
            val modeText = when(hostingMode) {
                HostingMode.FULL_AUTO -> "\u5168\u81ea\u52a8\u6a21\u5f0f"
                HostingMode.SEMI_AUTO -> "\u534a\u81ea\u52a8\u6a21\u5f0f"
                HostingMode.MONITOR_ONLY -> "\u4ec5\u8bb0\u5f55\u6a21\u5f0f"
            }
            val btnSubText = if (isHosting) modeText + " \u00b7 " + engineState else "\u70b9\u51fb\u5f00\u542f\u540e\u81ea\u52a8\u5904\u7406\u6d88\u606f"
            Surface(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp)
                    .clickable { onToggleHosting(!isHosting) },
                RoundedCornerShape(12.dp),
                color = btnBg
            ) {
                Column(
                    Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        btnText,
                        fontSize = 18.sp, fontWeight = FontWeight.Bold,
                        color = White
                    )
                    Text(
                        btnSubText,
                        fontSize = 12.sp,
                        color = White.copy(alpha = 0.8f),
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            Divider(color = Divider, thickness = 1.dp)
            Spacer(Modifier.height(14.dp))

            // 联系人管理
            Text(text = "联系人管理", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    Modifier.weight(1f).clickable { showWhitelist = true },
                    RoundedCornerShape(10.dp),
                    border = BorderStroke(1.5.dp, Green)
                ) {
                    Text(text = "白名单 (${whitelist.size})", modifier = Modifier.padding(vertical = 12.dp).fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Green)
                }
                Surface(
                    Modifier.weight(1f).clickable { showBlacklist = true },
                    RoundedCornerShape(10.dp),
                    border = BorderStroke(1.5.dp, Red)
                ) {
                    Text(text = "黑名单 (${blacklist.size})", modifier = Modifier.padding(vertical = 12.dp).fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Red)
                }
            }
        }
    }

    // 白名单弹窗
    if (showWhitelist) {
        AlertDialog(
            onDismissRequest = { showWhitelist = false },
            title = { Text("白名单管理", fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(Modifier.weight(1f), RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Divider)) {
                            BasicTextField(
                                value = newContact,
                                onValueChange = { newContact = it },
                                textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                                singleLine = true,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp).fillMaxWidth(),
                                decorationBox = { if (newContact.isEmpty()) Text("输入联系人或关键词", color = TextHint, fontSize = 14.sp) }
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = {
                            if (newContact.isNotBlank()) { whitelist = whitelist + newContact.trim(); newContact = "" }
                        }) { Text("添加", color = Green) }
                    }
                    Spacer(Modifier.height(12.dp))
                    if (whitelist.isEmpty()) {
                        Text("暂无白名单联系人", color = TextHint, fontSize = 13.sp)
                    } else {
                        whitelist.forEach { name ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(name, Modifier.weight(1f), fontSize = 14.sp, color = TextPrimary)
                                TextButton(onClick = { whitelist = whitelist - name }) { Text("删除", color = Red, fontSize = 12.sp) }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showWhitelist = false }) { Text("完成", color = Green) } }
        )
    }

    // 黑名单弹窗
    if (showBlacklist) {
        AlertDialog(
            onDismissRequest = { showBlacklist = false },
            title = { Text("黑名单管理", fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(Modifier.weight(1f), RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Divider)) {
                            BasicTextField(
                                value = newContact,
                                onValueChange = { newContact = it },
                                textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                                singleLine = true,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp).fillMaxWidth(),
                                decorationBox = { if (newContact.isEmpty()) Text("输入联系人或关键词", color = TextHint, fontSize = 14.sp) }
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = {
                            if (newContact.isNotBlank()) { blacklist = blacklist + newContact.trim(); newContact = "" }
                        }) { Text("添加", color = Red) }
                    }
                    Spacer(Modifier.height(12.dp))
                    if (blacklist.isEmpty()) {
                        Text("暂无黑名单联系人", color = TextHint, fontSize = 13.sp)
                    } else {
                        blacklist.forEach { name ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(name, Modifier.weight(1f), fontSize = 14.sp, color = TextPrimary)
                                TextButton(onClick = { blacklist = blacklist - name }) { Text("删除", color = Red, fontSize = 12.sp) }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showBlacklist = false }) { Text("完成", color = Green) } }
        )
    }
}

@Composable
private fun ToggleButton(checked: Boolean, onToggle: () -> Unit) {
    val bg = if (checked) Green else Color(0xFF555555)
    val txt = if (checked) "已开启" else "已关闭"
    Surface(
        Modifier.clickable { onToggle() },
        RoundedCornerShape(10.dp),
        color = bg
    ) {
        Text(
            txt,
            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            fontSize = 13.sp, fontWeight = FontWeight.Bold,
            color = White
        )
    }
}

// ══════════════════════ 卡片4: 设置 ══════════════════════

@Composable
private fun Card4Settings(
    token: String, onTokenChange: (String) -> Unit,
    tokenVerifyStatus: String, onVerifyToken: () -> Unit,
    weatherEnabled: Boolean, onWeatherToggle: (Boolean) -> Unit,
    timeEnabled: Boolean, onTimeToggle: (Boolean) -> Unit
) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.padding(18.dp)) {
            Text(text = "⚙️ 设置", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(14.dp))

            // 设备钥匙
            Text(text = "设备钥匙", fontSize = 13.sp, color = TextSecondary)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(Modifier.weight(1f), RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Divider)) {
                    Box(Modifier.padding(horizontal = 10.dp, vertical = 10.dp)) {
                        if (token.isEmpty()) Text(text = "mykey_2026_...", color = TextHint, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        BasicTextField(value = token, onValueChange = onTokenChange,
                            textStyle = TextStyle(color = TextPrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace),
                            singleLine = true, modifier = Modifier.fillMaxWidth())
                    }
                }
                Spacer(Modifier.width(8.dp))
                VerifyButton("验证", tokenVerifyStatus, onVerifyToken)
            }

            Spacer(Modifier.height(16.dp))

            // 天气感知
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(text = "天气感知", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                    Text(text = "开启后大模型自动知道今天天气", fontSize = 12.sp, color = TextSecondary)
                }
                ToggleButton(checked = weatherEnabled, onToggle = { onWeatherToggle(!weatherEnabled) })
            }

            Spacer(Modifier.height(14.dp))

            // 时间感知
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(text = "时间感知", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                    Text(text = "开启后大模型自动知道现在几点", fontSize = 12.sp, color = TextSecondary)
                }
                ToggleButton(checked = timeEnabled, onToggle = { onTimeToggle(!timeEnabled) })
            }
        }
    }
}
