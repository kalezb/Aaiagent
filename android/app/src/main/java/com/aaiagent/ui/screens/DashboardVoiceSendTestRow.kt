package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.engine.VoiceOutputMode
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted

/**
 * 语音发送测试入口。
 *
 * 第 1 步的真机验证用：按之前先停在目标联系人的 Soul 聊天页，点一下就会让 AiaAgent
 * 自己走完"点录音 → 暂停 → 发语音"。此刻录进去的还是真实环境音，
 * 等配音和麦克风注入接上以后，才会变成你自己的声音。
 */
@Composable
internal fun VoiceSendTestRow(
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
