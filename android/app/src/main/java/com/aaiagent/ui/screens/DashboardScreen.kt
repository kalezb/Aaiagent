package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.ui.theme.*

// ── Types ──

data class PermissionStatus(
    val accessibility: Boolean = false,
    val notification: Boolean = false,
    val batteryOptimization: Boolean = false,
    val overlay: Boolean = false
)

data class PersonaItem(val id: String, val name: String, val systemPrompt: String = "")

fun checkPermissionStatus(context: Context): PermissionStatus {
    val acc = try {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?.contains(context.packageName) == true
    } catch (_: Exception) { false }
    val notif = try {
        Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
            ?.contains(context.packageName) == true
    } catch (_: Exception) { false }
    val battery = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.isIgnoringBatteryOptimizations(context.packageName)
    } else true
    val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true
    return PermissionStatus(acc, notif, battery, overlay)
}

fun platformDisplayName(p: String) = when (p) {
    "soul" -> "Soul"; "qq" -> "QQ"; "immomo" -> "陌陌"; "lianxin" -> "连信"; else -> p
}

fun platformIcon(p: String) = when (p) {
    "soul" -> "🟣"; "qq" -> "🐧"; "immomo" -> "📱"; "lianxin" -> "💬"; else -> "📌"
}

// ── Main Dashboard ──

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
    monitorMode: Boolean,
    onMonitorModeChange: (Boolean) -> Unit,
    onToggleHosting: (Boolean) -> Unit
) {
    val ctx = LocalContext.current
    var perms by remember { mutableStateOf(checkPermissionStatus(ctx)) }
    LaunchedEffect(Unit) { perms = checkPermissionStatus(ctx) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Bg)
            .verticalScroll(rememberScrollState())
    ) {
        HeaderSection()
        StatusStrip(isHosting, engineState, enabledPlatforms.firstOrNull() ?: "soul")
        HeroToggleCard(isHosting, engineState, onToggleHosting)
        SectionLabel("平台选择")
        PlatformChips(enabledPlatforms, onTogglePlatform)
        SectionLabel("客服人设")
        PersonaCard(personas, activePersonaId, onPersonaChange, location, enabledPlatforms.firstOrNull() ?: "soul")
        SectionLabel("设备权限")
        PermissionCards(perms, ctx)
        SectionLabel("后端连接")
        BackendCard(token, apiBase, onTokenChange, onApiBaseChange)
        SectionLabel("发送模式")
        SendModeToggle(monitorMode, onMonitorModeChange)
        SectionLabel("运行日志")
        TerminalLog(lastReply, engineState, isHosting)

        Spacer(Modifier.height(32.dp))
    }
}

// ── Header ──

@Composable
private fun HeaderSection() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(
                    colors = listOf(Color(0xFF1A1040), Color(0xFF0F1A30)),
                    start = Offset(0f, 0f), end = Offset(Float.POSITIVE_INFINITY, 0f)
                )
            )
            .padding(20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(listOf(Purple, Blue))),
                contentAlignment = Alignment.Center
            ) { Text("🔮", fontSize = 20.sp) }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("AI 托管助手", color = TextHigh, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                Text("v2.0 · 4平台 · DeepSeek", color = Color(0xFF8B8BCC), fontSize = 10.sp)
            }
        }
    }
}

// ── Live Status Strip ──

@Composable
private fun StatusStrip(isHosting: Boolean, engineState: String, platform: String) {
    val bgColor by animateColorAsState(if (isHosting) Green.copy(alpha = 0.12f) else CardBg)
    val dotColor by animateColorAsState(if (isHosting) Green else TextLow)
    val pulseAlpha by rememberInfiniteTransition(label = "pulse").animateFloat(
        0.3f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "a"
    )

    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        shape = RoundedCornerShape(10.dp), color = bgColor,
        border = BorderStroke(1.dp, if (isHosting) Green.copy(alpha = 0.3f) else CardBorder)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(dotColor.copy(alpha = if (isHosting) pulseAlpha else 1f)))
            Spacer(Modifier.width(8.dp))
            Text(
                if (isHosting) "托管运行中" else "托管已暂停",
                color = if (isHosting) Green else TextLow, fontSize = 12.sp, fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.weight(1f))
            Text(platformIcon(platform), fontSize = 12.sp)
            Spacer(Modifier.width(4.dp))
            Text(platformDisplayName(platform), color = TextMid, fontSize = 12.sp)
            Spacer(Modifier.width(12.dp))
            Text("·", color = Divider, fontSize = 12.sp)
            Spacer(Modifier.width(12.dp))
            Text(engineState, color = TextLow, fontSize = 11.sp)
        }
    }
}

// ── Hero Toggle ──

@Composable
private fun HeroToggleCard(isHosting: Boolean, engineState: String, onToggle: (Boolean) -> Unit) {
    val cardBg by animateColorAsState(
        if (isHosting) Color(0xFF1A1040) else CardBg
    )
    val borderColor by animateColorAsState(
        if (isHosting) Purple.copy(alpha = 0.5f) else CardBorder
    )

    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(14.dp), color = cardBg,
        border = BorderStroke(1.5.dp, borderColor),
        shadowElevation = if (isHosting) 8.dp else 0.dp
    ) {
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("🔮 AI 托管", color = TextHigh, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text(
                    if (isHosting) "自动回复中 · $engineState" else "点击开启自动回复",
                    color = if (isHosting) Green else TextLow, fontSize = 12.sp
                )
            }
            NeonSwitch(checked = isHosting, onCheckedChange = onToggle)
        }
    }
}

// ── Neon Switch ──

@Composable
private fun NeonSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val bgColor by animateColorAsState(
        if (checked) Purple else Color(0xFF2A2A40)
    )
    val knobOffset by animateFloatAsState(if (checked) 1f else 0f, animationSpec = tween(250))
    val glow by animateFloatAsState(if (checked) 1f else 0f)

    Box(
        modifier = Modifier
            .width(56.dp).height(32.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(bgColor)
            .then(
                if (checked) Modifier.shadow(12.dp, RoundedCornerShape(16.dp), ambientColor = Purple, spotColor = Purple)
                else Modifier
            )
            .clickable { onCheckedChange(!checked) }
    ) {
        Box(
            modifier = Modifier
                .offset(x = (2 + (56 - 32 + 2) * knobOffset).dp, y = 2.dp)
                .size(28.dp)
                .clip(CircleShape)
                .background(if (checked) Color.White else Color(0xFF555570))
        )
    }
}

// ── Platform Chips ──

@Composable
private fun PlatformChips(enabled: Set<String>, onToggle: (String, Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        listOf("soul", "qq", "immomo", "lianxin").forEach { p ->
            val selected = enabled.contains(p)
            val chipBg by animateColorAsState(if (selected) Purple.copy(alpha = 0.25f) else CardBg)
            val chipBorder by animateColorAsState(if (selected) Purple.copy(alpha = 0.5f) else CardBorder)
            val chipText by animateColorAsState(if (selected) Color.White else TextMid)

            Surface(
                modifier = Modifier.weight(1f).clickable { onToggle(p, !selected) },
                shape = RoundedCornerShape(20.dp), color = chipBg,
                border = BorderStroke(1.dp, chipBorder)
            ) {
                Column(
                    modifier = Modifier.padding(vertical = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(platformIcon(p), fontSize = 18.sp)
                    Text(platformDisplayName(p), color = chipText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

// ── Persona Card ──

@Composable
private fun PersonaCard(
    personas: List<PersonaItem>,
    activeId: String,
    onChange: (String) -> Unit,
    location: UserLocationEntity,
    platform: String
) {
    val active = personas.find { it.id == activeId }
    val genderAge = if (activeId == "female") "女·29岁" else "男·30岁"

    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(12.dp), color = CardBg,
        border = BorderStroke(1.dp, CardBorder)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(40.dp).clip(CircleShape)
                    .background(Brush.linearGradient(listOf(Purple.copy(alpha = 0.4f), Blue.copy(alpha = 0.4f)))),
                contentAlignment = Alignment.Center
            ) { Text(if (activeId == "female") "👩" else "👨", fontSize = 18.sp) }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(active?.name ?: "未选择", color = TextHigh, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text("$genderAge · ${location.homeCity}${location.homeDistrict}", color = TextLow, fontSize = 11.sp)
            }
            // Persona selector
            if (personas.size > 1) {
                var expanded by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { expanded = true }) {
                        Icon(Icons.Default.ChevronRight, null, tint = TextLow, modifier = Modifier.size(20.dp))
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        personas.forEach { p ->
                            DropdownMenuItem(
                                text = { Text(p.name + if (p.id == activeId) " ✓" else "", fontSize = 13.sp) },
                                onClick = { onChange(p.id); expanded = false }
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── Permission Cards ──

@Composable
private fun PermissionCards(perms: PermissionStatus, ctx: Context) {
    Column(modifier = Modifier.padding(horizontal = 16.dp)) {
        PermRow("无障碍读取", "读屏+自动操作", perms.accessibility) {
            ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        PermRow("通知监听", "新消息提醒", perms.notification) {
            ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        PermRow("电池优化白名单", "防止被杀后台", perms.batteryOptimization) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                i.data = Uri.parse("package:" + ctx.packageName)
                ctx.startActivity(i)
            }
        }
        PermRow("悬浮窗权限", "边缘控制球", perms.overlay) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName)))
            }
        }
    }
}

@Composable
private fun PermRow(label: String, desc: String, granted: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { if (!granted) onClick() },
        shape = RoundedCornerShape(10.dp), color = CardBg,
        border = BorderStroke(1.dp, CardBorder)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(label, color = TextHigh, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Text(desc, color = TextLow, fontSize = 10.sp)
            }
            Spacer(Modifier.width(8.dp))
            val dotColor = if (granted) Green else Amber
            val txt = if (granted) "已授权" else "去设置"
            val txtColor = if (granted) Green else Amber
            Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(dotColor))
            Spacer(Modifier.width(6.dp))
            Text(txt, color = txtColor, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
    }
}

// ── Backend Config ──

@Composable
private fun BackendCard(token: String, apiBase: String, onTokenChange: (String) -> Unit, onApiBaseChange: (String) -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(12.dp), color = CardBg,
        border = BorderStroke(1.dp, CardBorder)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(Green))
                Spacer(Modifier.width(8.dp))
                Text("已连接", color = Green, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(10.dp))
            // API URL
            NeonTextField(
                value = apiBase, onValueChange = onApiBaseChange,
                placeholder = "API 地址", modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            // Token
            NeonTextField(
                value = token, onValueChange = onTokenChange,
                placeholder = "设备密钥 (Token)", modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun NeonTextField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier) {
    val borderColor by animateColorAsState(
        if (value.isNotEmpty()) Purple.copy(alpha = 0.4f) else CardBorder
    )
    Surface(
        modifier = modifier, shape = RoundedCornerShape(8.dp),
        color = Color(0xFF0D0D18), border = BorderStroke(1.dp, borderColor)
    ) {
        Box(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (value.isEmpty()) Text(placeholder, color = TextLow, fontSize = 13.sp)
            BasicTextField(
                value = value, onValueChange = onValueChange,
                textStyle = TextStyle(color = TextHigh, fontSize = 13.sp, fontFamily = FontFamily.Monospace),
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                cursorBrush = Brush.horizontalGradient(listOf(Purple, Blue))
            )
        }
    }
}

// ── Send Mode ──

@Composable
private fun SendModeToggle(monitorMode: Boolean, onToggle: (Boolean) -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(20.dp), color = Color(0xFF1E1E30)
    ) {
        Row(modifier = Modifier.padding(3.dp)) {
            listOf(false to "🤖 自动发送", true to "👀 仅记录").forEach { (mode, label) ->
                val sel = monitorMode == mode
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(17.dp))
                        .background(if (sel) Purple else Color.Transparent)
                        .clickable { onToggle(mode) }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (sel) Color.White else TextLow, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

// ── Terminal Log ──

@Composable
private fun TerminalLog(lastReply: String?, engineState: String, isHosting: Boolean) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 140.dp),
        shape = RoundedCornerShape(10.dp), color = TerminalBg,
        border = BorderStroke(1.dp, Color(0xFF1A1A30))
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // Fake terminal header
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(Red))
                Spacer(Modifier.width(6.dp))
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(Amber))
                Spacer(Modifier.width(6.dp))
                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(Green))
                Spacer(Modifier.width(12.dp))
                Text("ai-agent ~ log", color = TextLow, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.height(10.dp))
            // Log lines
            Text(
                "$ [${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}] 引擎状态: $engineState",
                color = TerminalText, fontSize = 11.sp, fontFamily = FontFamily.Monospace
            )
            if (isHosting) {
                Text(
                    "$ [--:--:--] 轮询扫描中 · 平台: Soul",
                    color = TerminalText.copy(alpha = 0.7f), fontSize = 11.sp, fontFamily = FontFamily.Monospace
                )
            }
            if (lastReply != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "$ [--:--:--] 最近回复: ${lastReply.take(50)}...",
                    color = TerminalText.copy(alpha = 0.5f), fontSize = 11.sp, fontFamily = FontFamily.Monospace,
                    maxLines = 2, overflow = TextOverflow.Ellipsis
                )
            }
            if (!isHosting && lastReply == null) {
                Text(
                    "$ [--:--:--] 等待托管启动...",
                    color = TextLow, fontSize = 11.sp, fontFamily = FontFamily.Monospace
                )
            }
        }
    }
}

// ── Section Label ──

@Composable
private fun SectionLabel(text: String) {
    Text(
        text, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 10.dp),
        color = TextLow, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = 2.sp
    )
}