package com.aaiagent.engine

object SoulViewportPolicy {
    private const val TOP_RATIO = 0.10f
    private const val BOTTOM_RATIO = 0.95f

    fun isMessageVisible(top: Int, bottom: Int, screenHeight: Int): Boolean {
        if (screenHeight <= 0 || bottom <= top) return false
        val contentTop = (screenHeight * TOP_RATIO).toInt()
        val contentBottom = (screenHeight * BOTTOM_RATIO).toInt()
        return top >= contentTop && bottom <= contentBottom
    }
}
