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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Visibility
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
import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyTextSecondary

@Composable
internal fun HostingModeSelector(
    hostingMode: HostingMode,
    onHostingModeChange: (HostingMode) -> Unit
) {
    val modes = listOf(
        Triple(HostingMode.FULL_AUTO, DashboardUiPolicy.hostingModeLabel(HostingMode.FULL_AUTO), Icons.Default.Bolt),
        Triple(HostingMode.SEMI_AUTO, DashboardUiPolicy.hostingModeLabel(HostingMode.SEMI_AUTO), Icons.Default.EditNote),
        Triple(HostingMode.MONITOR_ONLY, DashboardUiPolicy.hostingModeLabel(HostingMode.MONITOR_ONLY), Icons.Default.Visibility)
    )

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(17.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Row(
            Modifier.padding(5.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            modes.forEach { (mode, label, icon) ->
                val selected = hostingMode == mode
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onHostingModeChange(mode) },
                    shape = RoundedCornerShape(13.dp),
                    color = if (selected) SkySurface else Color.Transparent,
                    border = if (selected) BorderStroke(1.dp, SkyBlue.copy(alpha = 0.28f)) else null
                ) {
                    Column(
                        Modifier.padding(vertical = 13.dp, horizontal = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = if (selected) SkyBlue else SkyTextMuted,
                            modifier = Modifier.size(21.dp)
                        )
                        Spacer(Modifier.height(5.dp))
                        Text(
                            text = label,
                            color = if (selected) SkyBlue else SkyTextSecondary,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}
