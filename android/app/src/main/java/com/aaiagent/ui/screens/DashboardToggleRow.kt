package com.aaiagent.ui.screens

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkyText

@Composable
internal fun ToggleRow(
    icon: ImageVector,
    title: String,
    checked: Boolean,
    accent: Color,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        QuickIcon(icon, accent)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = SkyText,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
        }
        SkySwitch(checked = checked, onCheckedChange = null)
    }
}

@Composable
internal fun SkySwitch(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    darkBackground: Boolean = false
) {
    val trackColor by animateColorAsState(
        targetValue = if (checked) {
            if (darkBackground) Color.White.copy(alpha = 0.28f) else SkyBlue
        } else {
            SkyLineStrong
        },
        animationSpec = tween(180),
        label = "track"
    )
    val thumbOffset by animateDpAsState(
        targetValue = if (checked) 20.dp else 2.dp,
        animationSpec = tween(180),
        label = "thumb"
    )
    val clickableModifier = if (onCheckedChange == null) {
        Modifier
    } else {
        Modifier.clickable { onCheckedChange(!checked) }
    }

    Box(
        modifier = Modifier
            .then(clickableModifier)
            .width(46.dp)
            .height(26.dp)
            .clip(CircleShape)
            .background(trackColor),
        contentAlignment = Alignment.CenterStart
    ) {
        Box(
            Modifier
                .offset(x = thumbOffset)
                .size(20.dp)
                .clip(CircleShape)
                .background(Color.White)
        )
    }
}
