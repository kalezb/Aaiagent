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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.theme.*

data class PermissionStatus(
    val accessibility: Boolean = false,
    val notification: Boolean = false,
    val batteryOptimization: Boolean = false,
    val overlay: Boolean = false
)

data class PersonaItem(val id: String, val name: String, val systemPrompt: String = "")

fun checkPermissionStatus(context: Context): PermissionStatus {
    val acc = try { Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)?.contains(context.packageName) == true } catch (_: Exception) { false }
    val notif = try { Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true } catch (_: Exception) { false }
    val battery = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager; pm.isIgnoringBatteryOptimizations(context.packageName) } else true
    val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true
    return PermissionStatus(acc, notif, battery, overlay)
}

fun platformDisplayName(p: String) = when (p) { "soul" -> "Soul"; "qq" -> "QQ"; "immomo" -> "陌陌"; "lianxin" -> "连信"; else -> p }
fun platformIcon(p: String) = when (p) { "soul" -> "🟣"; "qq" -> "🐧"; "immomo" -> "📱"; "lianxin" -> "💬"; else -> "📌" }

// ═══════════════ DASHBOARD ═══════════════

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
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit,
    onVerifyToken: () -> Unit,
    tokenStatus: String,
    onToggleHosting: (Boolean) -> Unit
) {
    val ctx = LocalContext.current
    var perms by remember { mutableStateOf(checkPermissionStatus(ctx)) }
    LaunchedEffect(Unit) { perms = checkPermissionStatus(ctx) }

    Column(Modifier.fillMaxSize().background(Bg).verticalScroll(rememberScrollState())) {
        HeaderSection()
        StatusStrip(isHosting, engineState, enabledPlatforms.firstOrNull() ?: "soul")
        HeroToggleCard(isHosting, engineState, onToggleHosting)
        SectionLabel("平台选择")
        PlatformChips(enabledPlatforms, onTogglePlatform)
        SectionLabel("客服人设")
        PersonaCard(personas, activePersonaId, onPersonaChange, location, enabledPlatforms.firstOrNull() ?: "soul")
        SectionLabel("地址信息")
        LocationEditBlock(location, onLocationSave)
        SectionLabel("设备权限")
        PermissionCards(perms, ctx)
        SectionLabel("后端连接")
        BackendCard(token, apiBase, onTokenChange, onApiBaseChange, onVerifyToken, tokenStatus)
        SectionLabel("托管模式")
        HostingMode3Selector(hostingMode, onHostingModeChange)
        SectionLabel("运行日志")
        TerminalLog(lastReply, engineState, isHosting)
        Spacer(Modifier.height(32.dp))
    }
}

// ═══════════════ SECTIONS ═══════════════

@Composable
private fun HeaderSection() {
    Box(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFF1A1040), Color(0xFF0F1A30)), Offset(0f, 0f), Offset(Float.POSITIVE_INFINITY, 0f))).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient(listOf(Purple, Blue))), contentAlignment = Alignment.Center) { Text("🔮", fontSize = 20.sp) }
            Spacer(Modifier.width(12.dp))
            Column { Text("AI 托管助手", color = TextHigh, fontSize = 19.sp, fontWeight = FontWeight.Bold); Text("v2.0 · 4平台 · DeepSeek", color = Color(0xFF8B8BCC), fontSize = 10.sp) }
        }
    }
}

@Composable
private fun StatusStrip(isHosting: Boolean, engineState: String, platform: String) {
    val bg = animateColorAsState(if (isHosting) Green.copy(alpha = 0.12f) else CardBg).value
    val dot = animateColorAsState(if (isHosting) Green else TextLow).value
    val pulse = rememberInfiniteTransition(label = "p").animateFloat(0.3f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "pa").value
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), RoundedCornerShape(10.dp), color = bg, border = BorderStroke(1.dp, if (isHosting) Green.copy(alpha = 0.3f) else CardBorder)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(dot.copy(alpha = if (isHosting) pulse else 1f)))
            Spacer(Modifier.width(8.dp))
            Text(if (isHosting) "托管运行中" else "托管已暂停", color = if (isHosting) Green else TextLow, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            Text(platformIcon(platform), fontSize = 12.sp); Spacer(Modifier.width(4.dp))
            Text(platformDisplayName(platform), color = TextMid, fontSize = 12.sp)
            Spacer(Modifier.width(12.dp)); Text("·", color = Divider, fontSize = 12.sp); Spacer(Modifier.width(12.dp))
            Text(engineState, color = TextLow, fontSize = 11.sp)
        }
    }
}

@Composable
private fun HeroToggleCard(isHosting: Boolean, engineState: String, onToggle: (Boolean) -> Unit) {
    val bg = animateColorAsState(if (isHosting) Color(0xFF1A1040) else CardBg).value
    val border = animateColorAsState(if (isHosting) Purple.copy(alpha = 0.5f) else CardBorder).value
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), RoundedCornerShape(14.dp), color = bg, border = BorderStroke(1.5.dp, border), shadowElevation = if (isHosting) 8.dp else 0.dp) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("🔮 AI 托管", color = TextHigh, fontSize = 17.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(4.dp)); Text(if (isHosting) "自动回复中 · $engineState" else "点击开启自动回复", color = if (isHosting) Green else TextLow, fontSize = 12.sp) }
            NeonSwitch(checked = isHosting, onCheckedChange = onToggle)
        }
    }
}

@Composable
private fun NeonSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val bg = animateColorAsState(if (checked) Purple else Color(0xFF2A2A40)).value
    val off = animateFloatAsState(if (checked) 1f else 0f, tween(250)).value
    Box(Modifier.width(56.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(bg).then(if (checked) Modifier.shadow(12.dp, RoundedCornerShape(16.dp), ambientColor = Purple, spotColor = Purple) else Modifier).clickable { onCheckedChange(!checked) }) {
        Box(Modifier.offset(x = (2 + 22 * off).dp, y = 2.dp).size(28.dp).clip(CircleShape).background(if (checked) Color.White else Color(0xFF555570)))
    }
}

@Composable
private fun PlatformChips(enabled: Set<String>, onToggle: (String, Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("soul", "qq", "immomo", "lianxin").forEach { p ->
            val sel = enabled.contains(p)
            Surface(Modifier.weight(1f).clickable { onToggle(p, !sel) }, RoundedCornerShape(20.dp), color = animateColorAsState(if (sel) Purple.copy(alpha = 0.25f) else CardBg).value, border = BorderStroke(1.dp, animateColorAsState(if (sel) Purple.copy(alpha = 0.5f) else CardBorder).value)) {
                Column(Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(platformIcon(p), fontSize = 18.sp); Text(platformDisplayName(p), color = animateColorAsState(if (sel) Color.White else TextMid).value, fontSize = 12.sp, fontWeight = FontWeight.Medium) }
            }
        }
    }
}

@Composable
private fun PersonaCard(personas: List<PersonaItem>, activeId: String, onChange: (String) -> Unit, location: UserLocationEntity, platform: String) {
    val active = personas.find { it.id == activeId }
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), RoundedCornerShape(12.dp), color = CardBg, border = BorderStroke(1.dp, CardBorder)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Purple.copy(alpha = 0.4f), Blue.copy(alpha = 0.4f)))), contentAlignment = Alignment.Center) { Text(if (activeId == "female") "👩" else "👨", fontSize = 18.sp) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) { Text(active?.name ?: "未选择", color = TextHigh, fontSize = 14.sp, fontWeight = FontWeight.Medium); Text("${if (activeId == "female") "女·29岁" else "男·30岁"} · ${location.homeCity}${location.homeDistrict}", color = TextLow, fontSize = 11.sp) }
            if (personas.size > 1) { var exp by remember { mutableStateOf(false) }; Box { IconButton(onClick = { exp = true }) { Icon(Icons.Default.ChevronRight, null, tint = TextLow, modifier = Modifier.size(20.dp)) }; DropdownMenu(expanded = exp, onDismissRequest = { exp = false }) { personas.forEach { p -> DropdownMenuItem(text = { Text(p.name + if (p.id == activeId) " ✓" else "", fontSize = 13.sp) }, onClick = { onChange(p.id); exp = false }) } } } }
        }
    }
}

@Composable
private fun LocationEditBlock(location: UserLocationEntity, onSave: (String, String, String, String) -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), RoundedCornerShape(12.dp), color = CardBg, border = BorderStroke(1.dp, CardBorder)) {
        Column(Modifier.padding(14.dp)) {
            Text("家庭地址", color = TextLow, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MiniField(location.homeCity, { onSave(it, location.homeDistrict, location.workCity, location.workDistrict) }, "城市", Modifier.weight(1f))
                MiniField(location.homeDistrict, { onSave(location.homeCity, it, location.workCity, location.workDistrict) }, "区域", Modifier.weight(1f))
            }
            Spacer(Modifier.height(10.dp))
            Text("工作地址", color = TextLow, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MiniField(location.workCity, { onSave(location.homeCity, location.homeDistrict, it, location.workDistrict) }, "城市", Modifier.weight(1f))
                MiniField(location.workDistrict, { onSave(location.homeCity, location.homeDistrict, location.workCity, it) }, "区域", Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun MiniField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier) {
    Surface(modifier, RoundedCornerShape(7.dp), color = Color(0xFF0D0D18), border = BorderStroke(1.dp, if (value.isNotEmpty()) Purple.copy(alpha = 0.3f) else CardBorder)) {
        Box(Modifier.padding(horizontal = 10.dp, vertical = 7.dp)) {
            if (value.isEmpty()) Text(placeholder, color = TextLow, fontSize = 12.sp)
            BasicTextField(value = value, onValueChange = onChange, textStyle = TextStyle(color = TextHigh, fontSize = 13.sp), singleLine = true, modifier = Modifier.fillMaxWidth(), cursorBrush = Brush.horizontalGradient(listOf(Purple, Blue)))
        }
    }
}

@Composable
private fun PermissionCards(perms: PermissionStatus, ctx: Context) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        PermRow("无障碍读取", "读屏+自动操作", perms.accessibility) { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        PermRow("通知监听", "新消息提醒", perms.notification) { ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        PermRow("电池优化白名单", "防止被杀后台", perms.batteryOptimization) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS); i.data = Uri.parse("package:" + ctx.packageName); ctx.startActivity(i) } }
        PermRow("悬浮窗权限", "边缘控制球", perms.overlay) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))) }
    }
}

@Composable
private fun PermRow(label: String, desc: String, granted: Boolean, onClick: () -> Unit) {
    Surface(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { if (!granted) onClick() }, RoundedCornerShape(10.dp), color = CardBg, border = BorderStroke(1.dp, CardBorder)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(label, color = TextHigh, fontSize = 13.sp, fontWeight = FontWeight.Medium); Text(desc, color = TextLow, fontSize = 10.sp) }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(7.dp).clip(CircleShape).background(if (granted) Green else Amber))
            Spacer(Modifier.width(6.dp))
            Text(if (granted) "已授权" else "去设置", color = if (granted) Green else Amber, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun BackendCard(
    token: String, apiBase: String,
    onTokenChange: (String) -> Unit, onApiBaseChange: (String) -> Unit,
    onVerifyToken: () -> Unit, tokenStatus: String
) {
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), RoundedCornerShape(12.dp), color = CardBg, border = BorderStroke(1.dp, CardBorder)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(when { tokenStatus.startsWith("✅") -> Green; tokenStatus.startsWith("❌") -> Red; tokenStatus == "验证中..." -> Amber; token.isNotEmpty() -> Green; else -> TextLow }))
                Spacer(Modifier.width(8.dp))
                Text(if (tokenStatus.isNotEmpty()) tokenStatus else if (token.isNotEmpty()) "已配置密钥" else "未配置密钥", color = when { tokenStatus.startsWith("✅") -> Green; tokenStatus.startsWith("❌") -> Red; else -> TextLow }, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(Modifier.weight(1f), RoundedCornerShape(8.dp), color = Color(0xFF0D0D18), border = BorderStroke(1.dp, if (token.isNotEmpty()) Purple.copy(alpha = 0.4f) else CardBorder)) {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                        if (token.isEmpty()) Text("设备密钥 (Token)", color = TextLow, fontSize = 13.sp)
                        BasicTextField(value = token, onValueChange = onTokenChange, textStyle = TextStyle(color = TextHigh, fontSize = 13.sp, fontFamily = FontFamily.Monospace), singleLine = true, modifier = Modifier.fillMaxWidth(), cursorBrush = Brush.horizontalGradient(listOf(Purple, Blue)))
                    }
                }
                Spacer(Modifier.width(8.dp))
                Surface(Modifier.clickable { onVerifyToken() }, RoundedCornerShape(8.dp), color = Purple) {
                    Text("验证", Modifier.padding(horizontal = 14.dp, vertical = 10.dp), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

private data class ModeOpt(val mode: HostingMode, val label: String, val desc: String)

@Composable
private fun HostingMode3Selector(mode: HostingMode, onSelect: (HostingMode) -> Unit) {
    val opts = listOf(
        ModeOpt(HostingMode.FULL_AUTO, "🤖 全自动", "读取→AI回复→自动发送"),
        ModeOpt(HostingMode.SEMI_AUTO, "✋ 半自动", "读取→AI回复→填入输入框（不发送）"),
        ModeOpt(HostingMode.MONITOR_ONLY, "👀 仅记录", "只记录聊天数据，不调AI")
    )
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp), RoundedCornerShape(14.dp), color = Color(0xFF1E1E30)) {
        Column(Modifier.padding(4.dp)) {
            for (opt in opts) {
                val sel = mode == opt.mode
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(if (sel) Purple.copy(alpha = 0.2f) else Color.Transparent).clickable { onSelect(opt.mode) }.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(18.dp).clip(CircleShape).background(if (sel) Purple else Color.Transparent), contentAlignment = Alignment.Center) { if (sel) Box(Modifier.size(8.dp).clip(CircleShape).background(Color.White)) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) { Text(opt.label, color = if (sel) Color.White else TextMid, fontSize = 14.sp, fontWeight = FontWeight.Medium); Text(opt.desc, color = TextLow, fontSize = 10.sp) }
                }
            }
        }
    }
}

@Composable
private fun TerminalLog(lastReply: String?, engineState: String, isHosting: Boolean) {
    Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 140.dp), RoundedCornerShape(10.dp), color = TerminalBg, border = BorderStroke(1.dp, Color(0xFF1A1A30))) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(Red)); Spacer(Modifier.width(6.dp))
                Box(Modifier.size(8.dp).clip(CircleShape).background(Amber)); Spacer(Modifier.width(6.dp))
                Box(Modifier.size(8.dp).clip(CircleShape).background(Green)); Spacer(Modifier.width(12.dp))
                Text("ai-agent ~ log", color = TextLow, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
            Spacer(Modifier.height(10.dp))
            Text("$ [${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())}] 引擎状态: $engineState", color = TerminalText, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            if (isHosting) Text("$ [--:--:--] 轮询扫描中", color = TerminalText.copy(alpha = 0.7f), fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            if (lastReply != null) { Spacer(Modifier.height(4.dp)); Text("$ [--:--:--] 最近回复: ${lastReply.take(50)}...", color = TerminalText.copy(alpha = 0.5f), fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            if (!isHosting && lastReply == null) Text("$ [--:--:--] 等待托管启动...", color = TextLow, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, Modifier.padding(start = 20.dp, top = 20.dp, bottom = 10.dp), color = TextLow, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
}