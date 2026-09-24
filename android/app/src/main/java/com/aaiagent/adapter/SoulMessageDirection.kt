package com.aaiagent.adapter

object SoulMessageDirection {
    fun resolve(
        isSelfAvatar: Boolean,
        isOtherAvatar: Boolean,
        hasReadReceipt: Boolean,
        avatarCenterX: Int?,
        contentCenterX: Int?,
        screenWidth: Int
    ): String {
        if (isSelfAvatar && !isOtherAvatar) return "self"
        if (isOtherAvatar && !isSelfAvatar) return "other"

        val midpoint = screenWidth / 2
        if (avatarCenterX != null) {
            return if (avatarCenterX > midpoint) "self" else "other"
        }
        if (hasReadReceipt) return "self"
        if (contentCenterX != null) {
            return if (contentCenterX > midpoint) "self" else "other"
        }
        return "other"
    }
}
