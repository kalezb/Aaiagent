package com.aaiagent.adapter

/**
 * 聊天页里的系统提示行不是消息。
 *
 * 真机问题（2026-10-05）：聊天页最后一条读到的是“IP属地:重庆”，被当成对方最新一句，
 * 还有“你撤回了一条消息”“对方正在输入”这类提示同样会混进来。
 */
object SoulSystemNoticePolicy {
    private val PATTERNS = listOf(
        Regex("^IP属地[:：]"),
        Regex("^对方正在输入"),
        Regex("^你?正在输入"),
        Regex("撤回了一条消息"),
        Regex("^以下为新消息"),
        Regex("^\\d{1,2}:\\d{2}$"),
        Regex("^(?:今天|昨天|前天)\\s*\\d{1,2}:\\d{2}$"),
        Regex("^\\d{4}年\\d{1,2}月\\d{1,2}日"),
        Regex("^你已添加了"),
        Regex("^对方开启了"),
        Regex("^你们已成为好友"),
        Regex("^安全提醒"),
        Regex("^该消息已被"),
        // 2026-10-06 补：礼物、打赏、系统通知、平台活动这些也是系统嘴，不是他在说话。
        Regex("送出了?(?:一个|一份|礼物|\\d+个)"),
        Regex("^礼物榜"),
        Regex("打赏了?(?:你|TA|对方)?"),
        Regex("^系统(?:通知|提示|消息)"),
        Regex("^官方(?:通知|消息|提示)"),
        Regex("^安全中心"),
        Regex("^Soul小助手|^小助手"),
        Regex("^你收到"),
        Regex("^对方已(?:读|查看)"),
        Regex("^已读$"),
        Regex("^\\[?系统\\]?"),
        Regex("^互动(?:消息|提示)"),
        Regex("^匹配成功"),
        Regex("^你们的?缘分"),
        Regex("^TA(?:刚刚|刚才)"),
        Regex("^收到(?:了)?(?:一个|一份)?礼物"),
    )

    fun isNotice(text: String): Boolean {
        val value = text.trim()
        if (value.isEmpty()) return false
        return PATTERNS.any { it.containsMatchIn(value) }
    }
}
