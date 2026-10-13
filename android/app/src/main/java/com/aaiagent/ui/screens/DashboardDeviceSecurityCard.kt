package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyTextSecondary
import com.aaiagent.ui.theme.SkyWarm

@Composable
internal fun DeviceSecurityCard(
    token: String,
    onTokenChange: (String) -> Unit,
    tokenVerifyStatus: String,
    onVerifyToken: () -> Unit,
    grantedPermissions: Int
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "$grantedPermissions / 4 权限正常",
                    modifier = Modifier.weight(1f),
                    color = if (grantedPermissions == 4) SkyGreen else SkyWarm,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = if (grantedPermissions == 4) "已就绪" else "待完善",
                    color = if (grantedPermissions == 4) SkyGreen else SkyWarm,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(Modifier.height(13.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Key,
                    contentDescription = null,
                    tint = SkyBlue,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = "设备钥匙",
                    modifier = Modifier.weight(1f),
                    color = SkyTextSecondary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = tokenVerifyStatus.ifBlank { "未验证" },
                    color = when {
                        tokenVerifyStatus.startsWith("✓") -> SkyGreen
                        tokenVerifyStatus.startsWith("✗") -> SkyDanger
                        else -> SkyTextMuted
                    },
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.height(7.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                StyledTextField(
                    value = token,
                    onValueChange = onTokenChange,
                    placeholder = "输入设备钥匙",
                    monospace = true,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    modifier = Modifier.clickable(onClick = onVerifyToken),
                    shape = RoundedCornerShape(12.dp),
                    color = SkyBlue
                ) {
                    Text(
                        text = "验证",
                        modifier = Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}
