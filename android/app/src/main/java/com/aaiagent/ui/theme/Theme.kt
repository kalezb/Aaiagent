package com.aaiagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── Neon Dark Palette ──
val Bg          = Color(0xFF0A0A0F)
val SurfaceBg   = Color(0xFF111118)
val CardBg      = Color(0xFF181825)
val CardBorder  = Color(0xFF25253A)
val Purple      = Color(0xFF7C3AED)
val Blue        = Color(0xFF3B82F6)
val PurpleGlow  = Color(0x407C3AED)
val Green       = Color(0xFF22C55E)
val GreenGlow   = Color(0x4022C55E)
val Amber       = Color(0xFFF59E0B)
val Red         = Color(0xFFEF4444)
val TextHigh    = Color(0xFFF0F0FF)
val TextMid     = Color(0xFFB0B0D0)
val TextLow     = Color(0xFF6B6B9A)
val TerminalBg  = Color(0xFF06060D)
val TerminalText= Color(0xFF4ADE80)
val Divider     = Color(0xFF1E1E30)

// Legacy aliases for backward compat
val GreenDark = Green
val SurfaceDark = CardBg
val SurfaceDarker = Bg
val Border = CardBorder
val TextPrimary = TextHigh
val TextSecondary = TextMid
val Danger = Red
val Warn = Amber
val Gray = Color(0xFF555570)

private val Scheme = darkColorScheme(
    primary = Purple,
    secondary = Blue,
    background = Bg,
    surface = SurfaceBg,
    error = Red,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = TextHigh,
    onSurface = TextHigh,
    onError = Color.White
)

@Composable
fun AaiagentTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}