package com.aaiagent.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp

// Sky-blue single-page console
val SkyBlue        = Color(0xFF268CFF)
val SkyBlueDeep    = Color(0xFF126FD7)
val SkyBlueSoft    = Color(0xFFE1F0FF)
val SkyCyan        = Color(0xFF29B6B0)
val SkyGreen       = Color(0xFF16976D)
val SkyGreenSoft   = Color(0xFFE2F5EE)
val SkyWarm        = Color(0xFFF39A36)
val SkyWarmSoft    = Color(0xFFFFF1DF)
val SkyDanger      = Color(0xFFDC5860)
val SkyDangerSoft  = Color(0xFFFFE8EA)
val SkyBg          = Color(0xFFEDF5FC)
val SkySurface     = Color(0xFFFFFFFF)
val SkySurfaceRaised = Color(0xFFF7FBFF)
val SkyText        = Color(0xFF15243A)
val SkyTextSecondary = Color(0xFF5D7088)
val SkyTextMuted   = Color(0xFF8EA0B3)
val SkyLine        = Color(0xFFDCE8F3)
val SkyLineStrong  = Color(0xFFC9DBEA)

// Legacy aliases used by the floating window and older code paths.
val Green        = SkyBlue
val GreenLight   = SkyBlueSoft
val Red          = SkyDanger
val RedLight     = SkyDangerSoft
val White        = SkySurface
val Bg           = SkyBg
val CardBg       = SkySurface
val TextPrimary  = SkyText
val TextSecondary = SkyTextSecondary
val TextHint     = SkyTextMuted
val Divider      = SkyLine
val Gray         = SkyLineStrong
val GrayBg       = SkySurfaceRaised

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
val Warn = SkyWarm
val Amber = Warn
val TerminalBg = SkyText
val TerminalText = Green
val SurfaceBg = White
val PurpleGlow = Color(0x00000000)
val GreenGlow = Color(0x00000000)
val GreenDark = SkyBlueDeep

private val Scheme = lightColorScheme(
    primary = SkyBlue,
    secondary = SkyCyan,
    background = SkyBg,
    surface = SkySurface,
    surfaceVariant = SkySurfaceRaised,
    error = SkyDanger,
    onPrimary = White,
    onSecondary = White,
    onBackground = SkyText,
    onSurface = SkyText,
    onError = White
)

private val AppTypography = Typography(
    bodyLarge = Typography().bodyLarge.copy(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = Typography().bodyMedium.copy(fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = Typography().bodySmall.copy(fontSize = 13.sp, lineHeight = 19.sp),
    labelLarge = Typography().labelLarge.copy(fontSize = 14.sp),
    titleLarge = Typography().titleLarge.copy(fontSize = 22.sp),
    titleMedium = Typography().titleMedium.copy(fontSize = 18.sp),
    titleSmall = Typography().titleSmall.copy(fontSize = 15.sp)
)

@Composable
fun AaiagentTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = AppTypography, content = content)
}
