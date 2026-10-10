package com.aaiagent.engine

/**
 * 本 App 自己的悬浮窗 / 前台服务界面文字，绝不能当成聊天消息。
 *
 * 真机事故（2026-10-07 爱吃鱼🐟）：`AI 托管` 和 `已开启 AI 托管` 被当成对方发来的
 * 消息读进了 message_cache，还同步给了后端 —— 这等于当着对方的面说“我是 AI”。
 * 这些字来自悬浮窗（FloatingWindow / FloatingWindowStatus）和前台服务通知
 * （ForegroundService），读取聊天页时被一起读进来了。
 *
 * 判定按“去掉所有空白 + 转小写”后整条完全相等来比，**不做包含匹配** ——
 * 否则对方真说了“你是不是开了 AI 托管”也会被误删。
 */
object HostingOverlayTextPolicy {
    private val LABELS = listOf(
        "AI 托管",
        "已开启 AI 托管",
        "已关闭 AI 托管",
        "AI托管已开启",
        "AI托管已关闭",
        "AI托管运行中",
        "AI托管助手",
        "AI托管快捷开关",
        "悬浮控制已就绪",
    )

    private val NORMALIZED = LABELS.map(::normalize).toSet()

    fun isOverlayText(content: String?): Boolean {
        val normalized = normalize(content)
        return normalized.isNotEmpty() && normalized in NORMALIZED
    }

    private fun normalize(value: String?): String =
        value.orEmpty().filterNot(Char::isWhitespace).lowercase()
}