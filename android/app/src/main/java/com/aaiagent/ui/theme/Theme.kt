package com.aaiagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Green = Color(0xFF4ADE80)
val GreenDark = Color(0xFF22C55E)
val SurfaceDark = Color(0xFF1A1A1A)
val SurfaceDarker = Color(0xFF0F0F0F)
val Border = Color(0xFF333333)
val TextPrimary = Color(0xFFE0E0E0)
val TextSecondary = Color(0xFF999999)
val Danger = Color(0xFFEF4444)
val Warn = Color(0xFFF59E0B)
val Gray = Color(0xFF666666)

private val DarkColorScheme = darkColorScheme(
    primary = Green,
    secondary = GreenDark,
    background = SurfaceDarker,
    surface = SurfaceDark,
    error = Danger,
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onError = Color.White
)

@Composable
fun AaiagentTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}