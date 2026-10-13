package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.aaiagent.ui.theme.SkyCyan
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyWarm

@Composable
internal fun OverviewStats(
    isHosting: Boolean,
    platform: String,
    whitelistCount: Int,
    blacklistCount: Int
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp)
    ) {
        StatCard(
            value = if (isHosting) "运行" else "待机",
            label = "托管",
            valueColor = if (isHosting) SkyGreen else SkyWarm,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = platformDisplayName(platform),
            label = "当前平台",
            valueColor = SkyBlue,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = whitelistCount.toString(),
            label = "白名单",
            valueColor = SkyCyan,
            modifier = Modifier.weight(1f)
        )
        StatCard(
            value = blacklistCount.toString(),
            label = "黑名单",
            valueColor = SkyDanger,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun StatCard(
    value: String,
    label: String,
    valueColor: Color,
    modifier: Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(15.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(
            Modifier.padding(horizontal = 5.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = value,
                color = valueColor,
                fontSize = 21.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = label,
                color = SkyTextMuted,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
