package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.data.db.entity.UserLocationEntity
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.launch

data class PermissionStatus(
    val accessibility: Boolean = false,
    val notification: Boolean = false,
    val batteryOptimization: Boolean = false,
    val overlay: Boolean = false
)

fun checkPermissionStatus(context: Context): PermissionStatus {
    val accEnabled = try {
        val enabledServices = Settings.Secure.getString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )
        enabledServices?.contains(context.packageName) == true
    } catch (_: Exception) { false }
    val notifEnabled = try {
        val listeners = Settings.Secure.getString(
            context.contentResolver, "enabled_notification_listeners"
        )
        listeners?.contains(context.packageName) == true
    } catch (_: Exception) { false }
    val batteryExempt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.isIgnoringBatteryOptimizations(context.packageName)
    } else true
    val overlayGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
    } else true
    return PermissionStatus(accEnabled, notifEnabled, batteryExempt, overlayGranted)
}

data class PersonaItem(
    val id: String,
    val name: String,
    val systemPrompt: String = ""
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    token: String,
    apiBase: String,
    onTokenChange: (String) -> Unit,
    onApiBaseChange: (String) -> Unit,
    platforms: List<String>,
    enabledPlatforms: Set<String>,
    onTogglePlatform: (String, Boolean) -> Unit,
    personas: List<PersonaItem> = emptyList(),
    activePersonaId: String = "",
    onPersonaChange: (String) -> Unit = {},
    location: UserLocationEntity = UserLocationEntity(),
    onLocationSave: (String, String, String, String) -> Unit = { _, _, _, _ -> },
    monitorMode: Boolean = false,
    onMonitorModeChange: (Boolean) -> Unit = {},
    isHosting: Boolean = false,
    onToggleHosting: (Boolean) -> Unit = {}
) {
    val context = LocalContext.current
    val scrollState = rememberScrollState()
    var permissions by remember { mutableStateOf(checkPermissionStatus(context)) }
    var expandedPersona by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { permissions = checkPermissionStatus(context) }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(scrollState)
    ) {
        Text("\u8BBE\u7F6E", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = SurfaceDark)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("\u8BBE\u5907\u6743\u9650", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Spacer(Modifier.height(12.dp))
                PermissionRow("\u65E0\u969C\u788D\u8BFB\u53D6\u4E0E\u64CD\u4F5C", permissions.accessibility) { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                PermissionRow("\u901A\u77E5\u8BFB\u53D6", permissions.notification) { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
                PermissionRow("\u7535\u6C60\u4F18\u5316\u767D\u540D\u5355", permissions.batteryOptimization) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                        i.data = Uri.parse("package:" + context.packageName)
                        context.startActivity(i)
                    }
                }
                PermissionRow("\u60AC\u6D6E\u7A97\u6743\u9650", permissions.overlay) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + context.packageName)))
                    }
                }
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { permissions = checkPermissionStatus(context) }, modifier = Modifier.align(Alignment.End)) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("\u5237\u65B0\u72B6\u6001", fontSize = 12.sp)
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = SurfaceDark)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("\u5E73\u53F0\u4E0E\u4EBA\u8BBE", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Spacer(Modifier.height(12.dp))
                Text("\u76D1\u63A7\u5E73\u53F0\uFF08\u5355\u9009\uFF09", fontSize = 13.sp, color = TextSecondary)
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    platforms.forEach { platform ->
                        val selected = enabledPlatforms.contains(platform)
                        FilterChip(selected = selected, onClick = { onTogglePlatform(platform, !selected) },
                            label = { Text(platformDisplayName(platform), fontSize = 13.sp) },
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Green.copy(alpha = 0.2f), selectedLabelColor = Green),
                            modifier = Modifier.weight(1f))
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("\u5BA2\u670D\u4EBA\u8BBE", fontSize = 13.sp, color = TextSecondary)
                Spacer(Modifier.height(8.dp))
                if (personas.isNotEmpty()) {
                    ExposedDropdownMenuBox(expanded = expandedPersona, onExpandedChange = { expandedPersona = it }) {
                        val activeP = personas.find { it.id == activePersonaId }
                        OutlinedTextField(
                            value = activeP?.name ?: "\u672A\u9009\u62E9", onValueChange = {}, readOnly = true,
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expandedPersona) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, unfocusedBorderColor = Border, focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary),
                            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                        ExposedDropdownMenu(expanded = expandedPersona, onDismissRequest = { expandedPersona = false }) {
                            personas.forEach { persona ->
                                DropdownMenuItem(
                                    text = { Text(persona.name + if (persona.id == activePersonaId) " \u2714" else "", fontSize = 14.sp) },
                                    onClick = { onPersonaChange(persona.id); expandedPersona = false })
                            }
                        }
                    }
                } else {
                    Text("\u52A0\u8F7D\u4EBA\u8BBE\u4E2D...", fontSize = 13.sp, color = TextSecondary)
                }
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = location.homeCity, onValueChange = { onLocationSave(it, location.homeDistrict, location.workCity, location.workDistrict) },
                        label = { Text("\u57CE\u5E02", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true,
                        colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                    OutlinedTextField(value = location.homeDistrict, onValueChange = { onLocationSave(location.homeCity, it, location.workCity, location.workDistrict) },
                        label = { Text("\u533A\u57DF", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true,
                        colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                }
                Spacer(Modifier.height(12.dp))
                val activeP = personas.find { it.id == activePersonaId }
                Surface(modifier = Modifier.fillMaxWidth(), color = Green.copy(alpha = 0.1f), shape = RoundedCornerShape(8.dp)) {
                    val platName = platformDisplayName(enabledPlatforms.firstOrNull() ?: "soul")
                    val personName = activeP?.name ?: "\u672A\u9009"
                    val genderAge = if (activePersonaId == "female") "\u5973\u00B729\u5C81" else "\u7537\u00B730\u5C81"
                    Text("\u5F53\u524D\uFF1A$platName | $personName\u00B7$genderAge | ${location.homeCity}${location.homeDistrict}",
                        Modifier.padding(12.dp), fontSize = 13.sp, color = Green)
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = if (isHosting) Green.copy(alpha = 0.1f) else SurfaceDark),
            border = if (isHosting) androidx.compose.foundation.BorderStroke(1.dp, Green) else null) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("AI\u6258\u7BA1\u63A7\u5236", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text(if (isHosting) "\u6258\u7BA1\u8FD0\u884C\u4E2D" else "\u6258\u7BA1\u5DF2\u6682\u505C", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = if (isHosting) Green else TextSecondary)
                        Text(if (isHosting) "AI\u81EA\u52A8\u56DE\u590D\u6D88\u606F" else "AI\u6682\u505C\u56DE\u590D\uFF0C\u53EF\u624B\u52A8\u64CD\u4F5C", fontSize = 12.sp, color = TextSecondary)
                    }
                    Switch(checked = isHosting, onCheckedChange = onToggleHosting, colors = SwitchDefaults.colors(checkedThumbColor = Green, checkedTrackColor = Green.copy(alpha = 0.3f)))
                }
                Spacer(Modifier.height(12.dp))
                Divider(color = Border)
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("\u76D1\u63A7\u6A21\u5F0F", fontSize = 14.sp, color = TextPrimary)
                        Text("\u53EA\u8BB0\u5F55\u6D88\u606F\uFF0C\u4E0D\u8C03AI\u56DE\u590D", fontSize = 12.sp, color = TextSecondary)
                    }
                    Switch(checked = monitorMode, onCheckedChange = onMonitorModeChange, colors = SwitchDefaults.colors(checkedThumbColor = Warn, checkedTrackColor = Warn.copy(alpha = 0.3f)))
                }
                Spacer(Modifier.height(12.dp))
                Surface(modifier = Modifier.fillMaxWidth(), color = if (isHosting) Green.copy(alpha = 0.1f) else SurfaceDark, shape = RoundedCornerShape(8.dp)) {
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = SurfaceDark)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("\u4F4D\u7F6E\u8BBE\u7F6E", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Text("AI\u6839\u636E\u6B64\u4FE1\u606F\u56DE\u590D\u4F4F\u5740\u548C\u5DE5\u4F5C\u95EE\u9898", fontSize = 12.sp, color = TextSecondary)
                Spacer(Modifier.height(12.dp))
                Text("\u5BB6\u5EAD\u4F4F\u5740", fontSize = 13.sp, color = TextSecondary, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = location.homeCity, onValueChange = { onLocationSave(it, location.homeDistrict, location.workCity, location.workDistrict) },
                        label = { Text("\u57CE\u5E02", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                    OutlinedTextField(value = location.homeDistrict, onValueChange = { onLocationSave(location.homeCity, it, location.workCity, location.workDistrict) },
                        label = { Text("\u533A\u57DF", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                }
                Spacer(Modifier.height(12.dp))
                Text("\u5DE5\u4F5C\u5730\u5740", fontSize = 13.sp, color = TextSecondary, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = location.workCity, onValueChange = { onLocationSave(location.homeCity, location.homeDistrict, it, location.workDistrict) },
                        label = { Text("\u57CE\u5E02", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                    OutlinedTextField(value = location.workDistrict, onValueChange = { onLocationSave(location.homeCity, location.homeDistrict, location.workCity, it) },
                        label = { Text("\u533A\u57DF", fontSize = 12.sp) }, modifier = Modifier.weight(1f), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                }
                Spacer(Modifier.height(12.dp))
                Button(onClick = { onLocationSave(location.homeCity, location.homeDistrict, location.workCity, location.workDistrict) },
                    modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Green), shape = RoundedCornerShape(8.dp)) {
                    Icon(Icons.Default.Save, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("\u4FDD\u5B58\u4F4D\u7F6E", color = androidx.compose.ui.graphics.Color.White)
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = SurfaceDark)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("API \u914D\u7F6E", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = apiBase, onValueChange = onApiBaseChange, label = { Text("API \u5730\u5740") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = token, onValueChange = onTokenChange, label = { Text("\u8BBE\u5907\u5BC6\u94A5 (Token)") },
                    modifier = Modifier.fillMaxWidth(), singleLine = true, colors = fieldColors(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp))
            }
        }

        Spacer(Modifier.height(16.dp))

        Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = SurfaceDark)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("\u5173\u4E8E", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
                Spacer(Modifier.height(8.dp))
                Text("AI\u6258\u7BA1\u52A9\u624B v1.0", fontSize = 13.sp, color = TextSecondary)
                Text("\u652F\u6301 Soul / QQ / \u964C\u964C / \u8FDE\u4FE1", fontSize = 13.sp, color = TextSecondary)
                Text("\u57FA\u4E8E DeepSeek Chat", fontSize = 13.sp, color = TextSecondary)
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PermissionRow(label: String, isGranted: Boolean, onRequest: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable { if (!isGranted) onRequest() },
        horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = TextPrimary)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(4.dp), color = if (isGranted) Green.copy(alpha = 0.15f) else SurfaceDark) {
                Text(if (isGranted) "\u5DF2\u6388\u6743" else "\u53BB\u8BBE\u7F6E", Modifier.padding(horizontal = 10.dp, vertical = 4.dp), fontSize = 12.sp, color = if (isGranted) Green else Warn)
            }
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Default.ChevronRight, null, Modifier.size(18.dp), tint = TextSecondary)
        }
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, unfocusedBorderColor = Border, focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary)

fun platformDisplayName(platform: String): String = when (platform) {
    "soul" -> "Soul"
    "qq" -> "QQ"
    "immomo" -> "\u964C\u964C"
    "lianxin" -> "\u8FDE\u4FE1"
    else -> platform
}
