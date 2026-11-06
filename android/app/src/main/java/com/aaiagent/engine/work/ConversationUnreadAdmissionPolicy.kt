package com.aaiagent.engine.work

/**
 * 未读角标只负责提醒。进入聊天页前先用列表预览、列表时间和未读数核对：
 * 三项都和上次处理完时一样，说明只是旧提醒没消掉，不应反复点进去。
 */
object ConversationUnreadAdmissionPolicy {
    fun isStaleReminder(
        current: ConversationIdentity,
        handledPreview: String,
        handledLastMessageTime: String,
        handledUnreadCount: Int,
    ): Boolean {
        if (current.lastMessageTime.isBlank()) return false
        if (current.preview != handledPreview) return false
        if (current.lastMessageTime != handledLastMessageTime) return false
        return current.unreadCount <= handledUnreadCount.coerceAtLeast(1)
    }
}
