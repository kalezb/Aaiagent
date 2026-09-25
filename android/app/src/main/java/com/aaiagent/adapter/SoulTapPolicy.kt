package com.aaiagent.adapter

object SoulTapPolicy {
    fun clampPoint(x: Int, y: Int, screenWidth: Int, screenHeight: Int): TapPoint {
        val maxX = (screenWidth - 1).coerceAtLeast(0)
        val maxY = (screenHeight - 1).coerceAtLeast(0)
        return TapPoint(
            x = x.coerceIn(0, maxX),
            y = y.coerceIn(0, maxY)
        )
    }

    data class TapPoint(val x: Int, val y: Int)
}
