package com.aaiagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── 白底绿主色 ──
val Green       = Color(0xFF22C55E)
val GreenLight  = Color(0xFFDCFCE7)
val Red         = Color(0xFFEF4444)
val RedLight    = Color(0xFFFEE2E2)
val White       = Color(0xFFFFFFFF)
val Bg          = Color(0xFFF5F5F5)
val CardBg      = Color(0xFFFFFFFF)
val TextPrimary = Color(0xFF1A1A1A)
val TextSecondary = Color(0xFF999999)
val TextHint    = Color(0xFFBBBBBB)
val Divider     = Color(0xFFEEEEEE)
val Gray        = Color(0xFFCCCCCC)
val GrayBg      = Color(0xFFF0F0F0)

// Legacy aliases
val SurfaceDark = CardBg
val SurfaceDarker = Bg
val Border = Divider
val Purple = Green
val Blue = Green
val CardBorder = Divider
val TextHigh = TextPrimary
val TextMid = TextSecondary
val TextLow = TextHint
val Danger = Red
val Warn = Color(0xFFF59E0B)
val Amber = Warn
val TerminalBg = Color(0xFF1A1A1A)
val TerminalText = Green
val SurfaceBg = White
val PurpleGlow = Color(0x00000000)
val GreenGlow = Color(0x00000000)
val GreenDark = Green

private val Scheme = lightColorScheme(
    primary = Green,
    secondary = Green,
    background = Bg,
    surface = White,
    error = Red,
    onPrimary = White,
    onSecondary = White,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onError = White
)

@Composable
fun AaiagentTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}