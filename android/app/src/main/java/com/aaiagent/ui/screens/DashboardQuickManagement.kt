package com.aaiagent.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyCyan
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyWarm

@Composable
internal fun QuickManagement(
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
internal fun RowDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 64.dp)
            .height(1.dp)
            .background(SkyLine)
    )
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
