package com.aaiagent.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsoleScreen(
    isHosting: Boolean,
    onToggleHosting: (Boolean) -> Unit,
    platformsStatus: Map<String, Boolean>,
    engineState: String,
    lastReply: String?
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text("控制台", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)

        Spacer(Modifier.height(20.dp))

        // 托管大开关
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = if (isHosting) Green.copy(alpha = 0.15f) else SurfaceDark),
            border = if (isHosting) androidx.compose.foundation.BorderStroke(1.dp, Green) else null
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        if (isHosting) "托管运行中" else "托管已暂停",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isHosting) Green else TextSecondary
                    )
                    Text(
                        "状态: $engineState",
                        fontSize = 13.sp,
                        color = TextSecondary
                    )
                }
                Switch(
                    checked = isHosting,
                    onCheckedChange = onToggleHosting,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Green,
                        checkedTrackColor = Green.copy(alpha = 0.3f)
                    )
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        // 平台状态
        Text("平台连接状态", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            listOf(
                "soul" to "Soul",
                "qq" to "QQ",
                "immomo" to "陌陌",
                "lianxin" to "连信"
            ).forEach { (key, name) ->
                val active = platformsStatus[key] ?: false
                PlatformStatusBadge(
                    name = name,
                    isActive = active,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        // 最近回复
        if (lastReply != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("最近回复", fontSize = 14.sp, color = TextSecondary)
                    Spacer(Modifier.height(8.dp))
                    Text(lastReply, fontSize = 15.sp, color = TextPrimary)
                }
            }
        }
    }
}

@Composable
fun PlatformStatusBadge(name: String, isActive: Boolean, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isActive) Green.copy(alpha = 0.15f) else SurfaceDark
        ),
        border = if (isActive) androidx.compose.foundation.BorderStroke(1.dp, Green.copy(alpha = 0.5f))
        else androidx.compose.foundation.BorderStroke(1.dp, Border)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (isActive) Green else Gray)
            )
            Spacer(Modifier.height(6.dp))
            Text(name, fontSize = 12.sp, color = TextPrimary)
        }
    }
}