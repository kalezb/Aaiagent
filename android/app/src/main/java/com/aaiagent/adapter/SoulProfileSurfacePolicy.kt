package com.aaiagent.adapter

/**
 * Soul 聊天页顶部也会放一张很长的关系卡片。
 *
 * 它里面会出现头像、标签、共同点等控件，发送消息时还会重画。只用几个控件名字判断，
 * 很容易把正常聊天页认成资料页，随后触发自动返回。这里把“真资料页窗口”和
 * “同一个聊天窗口里短暂冒出来的资料页控件”分开处理。
 */
object SoulProfileSurfacePolicy {
    private val PROFILE_WINDOW_TOKENS = listOf(
        "userhomeactivity",
        "profileactivity",
    )

    fun isProfileWindow(windowClassName: String): Boolean {
        val normalized = windowClassName.trim().lowercase()
        return PROFILE_WINDOW_TOKENS.any(normalized::contains)
    }

    fun shouldTreatAsProfilePage(
        profileMarkerCount: Int,
        hasChatInput: Boolean,
        hasChatTitle: Boolean,
        windowClassName: String,
    ): Boolean {
        if (profileMarkerCount < 2) return false
        if (isProfileWindow(windowClassName)) return true
        return !hasChatInput && !hasChatTitle
    }
}
