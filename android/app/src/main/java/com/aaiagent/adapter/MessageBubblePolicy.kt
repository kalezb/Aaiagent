package com.aaiagent.adapter

/**
 * 一个 item_root 到底算不算聊天消息。
 *
 * 2026-10-05 两次真机踩坑：
 *  太松：只看 item_root → 把个人主页/展品馆/收藏的内容当消息读（小胡读到 33 条，最后一条是主页元素，
 *        判成“无需回复”，用户看到的就是点进资料页然后退出会话）；
 *  太严：要求必须有 layout_content → 新联系人页面里的真消息被滤掉（野兽 items=1 bubbles=0，不回复）。
 * 现在的口径：不在个人主页卡片/媒体面板里，且有文字或媒体节点，就算消息。
 */
object MessageBubblePolicy {
    fun isMessage(
        insideProfileCard: Boolean,
        insideNonMessagePanel: Boolean,
        hasText: Boolean,
        hasTextContainer: Boolean,
        hasMedia: Boolean,
        relaxContentCheck: Boolean = false,
    ): Boolean {
        if (insideProfileCard) return false
        if (insideNonMessagePanel) return false
        // 新会话页面通常只有 1-3 条，基本都是真消息；这时不再要求内容形态，
        // 否则真消息会被滤掉（真机：野兽 items=1 bubbles=0）。
        if (relaxContentCheck) return true
        return hasText || hasTextContainer || hasMedia
    }
}
