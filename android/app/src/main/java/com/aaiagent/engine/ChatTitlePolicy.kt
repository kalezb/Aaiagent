package com.aaiagent.engine

object ChatTitlePolicy {
    private val blockedExact = setOf(
        "发送",
        "取消",
        "确定",
        "关闭",
        "返回",
        "聊天",
        "消息",
        "更多",
        "设置",
        "允许",
        "知道了",
        "好的",
        "语音通话",
        "视频通话",
        "关注后可邀请通话"
    )

    private val blockedFragments = listOf(
        "关注后可",
        "邀请通话",
        "点击发送",
        "按住说话"
    )

    fun sanitize(value: String?): String? {
        val text = value?.trim().orEmpty()
        val normalized = ConversationIdentity.normalize(text)
        if (normalized.length !in 1..40) return null
        if (normalized.length <= 3 && normalized.all(Char::isDigit)) return null
        if (blockedExact.any { it.equals(normalized, ignoreCase = true) }) return null
        if (blockedFragments.any { normalized.contains(it, ignoreCase = true) }) return null
        return text
    }
}
