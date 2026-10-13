package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyDangerSoft
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyGreenSoft
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyTextMuted

@Composable
internal fun PlatformPersonaCard(
    enabledPlatforms: Set<String>,
    onTogglePlatform: (String, Boolean) -> Unit,
    syncPlatform: (String) -> Unit,
    personas: List<PersonaItem>,
    activePersonaId: String,
    onPersonaChange: (String) -> Unit,
    personaVerifyStatus: String,
    onVerifyPersona: () -> Unit,
    platformSyncStatus: String,
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
            SelfNicknameRow(
                value = selfNickname,
                onValueChange = onSelfNicknameChange
            )
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
