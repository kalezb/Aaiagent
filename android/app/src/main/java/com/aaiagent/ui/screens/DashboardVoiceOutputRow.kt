package com.aaiagent.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.engine.VoiceOutputMode
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText

/**
 * 配音怎么送进 Soul 的录音。
 *
 * - **自动**：能注入就注入（音质干净，需要 root + LSPosed），不能就用扬声器放出来录（不需要 root）
 * - 手动锁定：方便在同一台手机上对比两种效果
 *
 * 音量不在这里管 —— 用户明确要求音量由他自己控制。
 */
@Composable
internal fun VoiceOutputRow(
    mode: String,
    onModeChange: (String) -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 13.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            QuickIcon(Icons.AutoMirrored.Filled.VolumeUp, SkyGreen)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = "配音方式",
                    color = SkyText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "自动：能注入就注入，没 root 就用扬声器放出来录",
                    color = SkyLineStrong,
                    fontSize = 12.sp
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth()) {
            listOf(
                VoiceOutputMode.AUTO to "自动",
                VoiceOutputMode.INJECT to "注入",
                VoiceOutputMode.SPEAKER to "外放"
            ).forEach { (value, label) ->
                val selected = mode == value
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .padding(end = 6.dp)
                        .clickable { onModeChange(value) },
                    shape = RoundedCornerShape(10.dp),
                    color = if (selected) SkyGreen.copy(alpha = 0.16f) else SkySurfaceRaised
                ) {
                    Box(
                        Modifier.padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = label,
                            color = if (selected) SkyGreen else SkyText,
                            fontSize = 12.sp,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }
            }
        }
    }
}
