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

    fun isBottomNavigationBounds(
        left: Int,
        top: Int,
        right: Int,
        bottom: Int,
        screenWidth: Int,
        screenHeight: Int
    ): Boolean {
        if (screenWidth <= 0 || screenHeight <= 0) return false
        if (right <= left || bottom <= top) return false
        if (left < 0 || right > screenWidth || top < 0 || bottom > screenHeight) return false
        if (bottom < screenHeight * 9 / 10) return false
        if (top < screenHeight * 9 / 10) return false

        val centerX = (left + right) / 2
        val centerY = (top + bottom) / 2
        return isNavigationTapSafe(centerX, centerY, screenWidth, screenHeight)
    }

    /**
     * Distance from the physical screen bottom to the centre of Soul's bottom
     * tab row. Measured on device: 2400px screen, tab row centred near 2310.
     */
    const val BOTTOM_TAB_INSET_PX = 90

    /**
     * Y of Soul's bottom tab row anchored to the physical screen. The
     * accessibility bounds of that row are reported inside the app area, so
     * tapping them directly can land above the real tabs.
     */
    fun bottomTabCenterY(
        realScreenHeight: Int,
        insetPx: Int = BOTTOM_TAB_INSET_PX,
    ): Int {
        if (realScreenHeight <= 0) return 0
        return (realScreenHeight - insetPx).coerceAtLeast(realScreenHeight / 2)
    }

    fun isNavigationTapSafe(x: Int, y: Int, screenWidth: Int, screenHeight: Int): Boolean {
        if (screenWidth <= 0 || screenHeight <= 0) return false
        if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) return false
        return !isPublishHotspot(x = x, y = y, screenWidth = screenWidth, screenHeight = screenHeight)
    }

    fun matchesViewId(actualViewId: String?, expectedViewId: String?, prefix: String): Boolean {
        if (expectedViewId.isNullOrBlank()) return true
        if (actualViewId.isNullOrBlank()) return false
        return actualViewId == expectedViewId || actualViewId == prefix + expectedViewId
    }

    private fun isPublishHotspot(x: Int, y: Int, screenWidth: Int, screenHeight: Int): Boolean {
        val left = screenWidth * 2 / 5
        val right = screenWidth * 3 / 5
        val top = screenHeight * 98 / 100
        return x in left..right && y >= top
    }

    data class TapPoint(val x: Int, val y: Int)
}
