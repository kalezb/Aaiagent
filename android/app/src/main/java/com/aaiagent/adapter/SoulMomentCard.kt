package com.aaiagent.adapter

object SoulMomentCard {
    const val TYPE = "moment_card"
    const val FALLBACK = "[对方转发了你本人的动态]"

    fun format(
        author: String?,
        content: String?,
        forwardedByOther: Boolean
    ): String {
        val safeAuthor = author?.trim().orEmpty()
        val safeContent = content?.trim().orEmpty()
        val prefix = if (forwardedByOther) "[对方转发了你本人的动态]" else "[转发了动态]"
        val authorText = if (forwardedByOther && safeAuthor.isNotEmpty()) {
            "动态作者：$safeAuthor（你本人）"
        } else if (safeAuthor.isNotEmpty()) {
            "动态作者：$safeAuthor"
        } else {
            ""
        }
        val contentText = if (forwardedByOther && safeContent.isNotEmpty()) {
            "动态正文（你本人发布）：$safeContent"
        } else if (safeContent.isNotEmpty()) {
            "动态正文：$safeContent"
        } else {
            ""
        }
        return listOf(prefix, authorText, contentText)
            .filter { it.isNotEmpty() }
            .joinToString("。")
    }
}
