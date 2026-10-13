package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyBlueDeep
import com.aaiagent.ui.theme.SkyBlueSoft
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyTextSecondary

@Composable
internal fun HostingHero(
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
