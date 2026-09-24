package com.aaiagent.adapter

object SoulMomentCard {
    const val TYPE = "moment_card"
    const val FALLBACK = "[转发瞬间]"

    fun format(author: String?, content: String?): String {
        val safeAuthor = author?.trim().orEmpty()
        val safeContent = content?.trim().orEmpty()
        return when {
            safeAuthor.isNotEmpty() && safeContent.isNotEmpty() -> "$FALLBACK $safeAuthor：$safeContent"
            safeAuthor.isNotEmpty() -> "$FALLBACK $safeAuthor"
            safeContent.isNotEmpty() -> "$FALLBACK $safeContent"
            else -> FALLBACK
        }
    }
}
