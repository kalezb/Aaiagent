package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.R
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyTextSecondary
import com.aaiagent.ui.theme.SkyWarm

@Composable
internal fun DashboardHeader(
    versionName: String,
    connectionText: String,
    connectionTone: ConnectionTone
) {
    val toneColor = when (connectionTone) {
        ConnectionTone.GREEN -> SkyGreen
        ConnectionTone.YELLOW -> SkyWarm
        ConnectionTone.RED -> SkyDanger
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Image(
            painter = painterResource(R.drawable.ic_brand_mark),
            contentDescription = "AI 托管助手",
            modifier = Modifier.size(50.dp)
        )

        Spacer(Modifier.width(12.dp))

        Column(Modifier.weight(1f)) {
            Text(
                text = "AI 托管助手",
                color = SkyText,
                fontSize = 23.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "v$versionName · 控制台",
                color = SkyTextMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Surface(
            shape = RoundedCornerShape(999.dp),
            color = SkySurfaceRaised,
            border = BorderStroke(1.dp, SkyLine)
        ) {
            Row(
                Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(toneColor)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = connectionText,
                    color = if (connectionTone == ConnectionTone.GREEN) SkyTextSecondary else toneColor,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
