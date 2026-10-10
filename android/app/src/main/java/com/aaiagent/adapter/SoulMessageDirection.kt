package com.aaiagent.adapter

object SoulMessageDirection {
    fun resolve(
        isSelfAvatar: Boolean,
        isOtherAvatar: Boolean,
        hasReadReceipt: Boolean,
        avatarCenterX: Int?,
        contentCenterX: Int?,
        screenWidth: Int,
        // 2026-10-06：闪照/阅后即焚有专属收发根节点，比几何推断可靠。
        isSentSnap: Boolean = false,
        isReceivedSnap: Boolean = false,
    ): String {
        if (isSentSnap && !isReceivedSnap) return "self"
        if (isReceivedSnap && !isSentSnap) return "other"
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
