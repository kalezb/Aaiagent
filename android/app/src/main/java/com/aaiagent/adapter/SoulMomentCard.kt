package com.aaiagent.adapter

/**
 * 聊天页里的「转发动态」卡片。
 *
 * 只做一件事：把卡片上**现成的字**读出来拼成一句人话交给大模型。
 *
 * 刻意不做任何匹配、打分或知识库检索 —— 那些本质是靠猜，上一版就是因为猜得太差
 * 被整体删掉。这里坚持"读出来"，读不到就如实说读不到。
 *
 * 配图由截图 + 视觉模型单独补上（见 [withImageDescription] 和 MessageEngine 的媒体理解）。
 */
object SoulMomentCard {
    const val TYPE = "moment_card"

    /** 作者和正文都读不到时的兜底，至少让模型知道"这是一条转发动态"。 */
    const val FALLBACK = "[对方转发了动态]"

    /**
     * 拼卡片文字。
     *
     * 故意**不写**"你本人的动态"：转发过来的可能是你发的，也可能是对方自己的或第三个人的，
     * 光看卡片判断不出来。这里只如实报作者名，是不是自己发的交给模型结合账号昵称去认。
     */
    fun format(
        author: String?,
        content: String?,
        forwardedByOther: Boolean
    ): String {
        val safeAuthor = author?.trim().orEmpty()
        val safeContent = content?.trim().orEmpty()
        val prefix = if (forwardedByOther) "[对方转发了动态]" else "[转发了动态]"
        val authorText = if (safeAuthor.isNotEmpty()) "动态作者：$safeAuthor" else ""
        val contentText = if (safeContent.isNotEmpty()) "动态正文：$safeContent" else ""
        return listOf(prefix, authorText, contentText)
            .filter { it.isNotEmpty() }
            .joinToString("。")
    }

    /**
     * 把视觉模型对配图的客观描述拼到卡片文字后面。
     *
     * 截图失败或识别结果为空时**原样返回卡片文字**，绝不让一张图把整条卡片变成空内容。
     */
    fun withImageDescription(cardText: String, description: String?): String {
        val text = cardText.trim().ifEmpty { FALLBACK }
        val desc = description?.trim().orEmpty()
        if (desc.isEmpty()) return text
        return "$text。动态配图（客观识别）：$desc。" +
            "回复必须以这条识别事实为准，不能改猜成其他人或无关物品。"
    }
}