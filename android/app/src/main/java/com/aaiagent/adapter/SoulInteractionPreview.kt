package com.aaiagent.adapter

object SoulInteractionPreview {
    private val GENERIC_LABELS = setOf(
        "图片",
        "图片消息",
        "表情",
        "表情包",
        "互动表情",
        "Soul互动表情",
        "语音",
        "语音消息",
        "语音互动表情",
        "视频",
        "视频消息",
        "闪照",
        "文件",
        "动态",
        "分享",
        "位置",
        "名片"
    )

    fun resolve(raw: String): String? {
        val text = raw.trim()
        if (text.length < 3) return null
        val inner = when {
            text.startsWith("[") && text.endsWith("]") -> text.substring(1, text.length - 1)
            text.startsWith("【") && text.endsWith("】") -> text.substring(1, text.length - 1)
            else -> return null
        }.trim()
        if (inner.isEmpty() || inner.length > 12) return null
        if (inner in GENERIC_LABELS) return null
        return inner
    }

    fun modelTextFor(label: String): String {
        return "消息列表明确标注对方最后一条消息是「$label」，这是本地聊天记录标签，不受当前查看时间影响"
    }
}
