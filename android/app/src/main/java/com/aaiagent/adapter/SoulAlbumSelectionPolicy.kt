package com.aaiagent.adapter

/**
 * Soul places iv_photo and fl_select_mark under the same clickable FrameLayout.
 * Prefer the visible marker, then the clickable parent, and only use the image
 * itself as the final gesture fallback.
 */
object SoulAlbumSelectionPolicy {
    fun isSelectionMarkerSelected(
        contentDescription: CharSequence?,
        isSelected: Boolean
    ): Boolean {
        return isSelected || contentDescription?.toString()?.contains("已选中") == true
    }

    fun fallbackSendPoint(
        screenWidth: Int,
        screenHeight: Int,
        bottomBarTop: Int? = null,
        bottomBarRight: Int? = null,
        bottomBarBottom: Int? = null
    ): SoulTapPolicy.TapPoint {
        val actionRight = bottomBarRight?.takeIf { it > 0 } ?: screenWidth
        val visualTop = bottomBarTop?.takeIf { it > 0 }
        val targetY = visualTop?.plus(BOTTOM_BAR_SEND_OFFSET)
            ?: (screenHeight * SEND_Y_RATIO).toInt()
        val gestureWidth = maxOf(screenWidth, actionRight)
        val gestureHeight = maxOf(screenHeight, bottomBarBottom ?: 0, targetY + 1)
        return SoulTapPolicy.clampPoint(
            x = actionRight - (screenWidth * SEND_RIGHT_INSET_RATIO).toInt(),
            y = targetY,
            screenWidth = gestureWidth,
            screenHeight = gestureHeight
        )
    }

    fun <T> chooseTapTarget(
        photo: T,
        marker: T?,
        parentOf: (T) -> T?,
        isClickable: (T) -> Boolean,
        isVisible: (T) -> Boolean
    ): T {
        if (marker != null && isVisible(marker)) return marker
        val parent = parentOf(photo)
        if (parent != null && isClickable(parent) && isVisible(parent)) return parent
        return photo
    }

    private const val SEND_RIGHT_INSET_RATIO = 0.134f
    private const val SEND_Y_RATIO = 0.957f
    private const val BOTTOM_BAR_SEND_OFFSET = 59
}
