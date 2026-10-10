package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * 2026-10-07 真机（貌若潘安的黄金圣斗士）：读屏偶尔把「资料页 / 会话列表」当成聊天页读进来，
 * 一次就是整屏垃圾：
 *   26 / 38 / 关注 / 备注 / 密友 / 群组 / 我的关注 / 全部 / 一一 / 私聊 / 匹配 / Souler
 *   3小时前 / 10月6日 07:33 / 17:08 / 97%
 *   别的联系人昵称（雾锁星河岸、久伴有喜、晚风凉、再遇见）
 * 一次误读把该联系人 42% 的历史污染了，模型从此「答旧话、反复问同一个问题」。
 *
 * 判断按“整批”来做：只有一批里出现 >= 3 条这种形状的条目，才认定这一屏是误读，把它们剔掉；
 * 零星出现（比如他真答了一句“28”表示年龄）保留，宁可放过、不可错杀真实消息。
 */
object MessageJunkPolicy {
    const val JUNK_BATCH_THRESHOLD = 3

    private val UI_LABELS = setOf(
        "关注", "备注", "密友", "群组", "我的关注", "全部", "一一", "私聊", "匹配", "Souler",
        "官方号", "关注我", "打招呼", "送礼物", "举报", "拉黑", "更多", "主页", "我的", "设置",
        "编辑", "返回", "取消", "确定", "保存", "发送", "表情", "图片", "语音", "位置", "名片",
        "红包", "转账", "领取", "签到", "会员", "充值", "立即", "查看", "在线", "离线"
    )

    private val TIME_LIKE = Regex(
        "^(?:刚刚|刚才|片刻前|稍前|\\d+\\s*(?:秒|分钟|小时|天)前|昨天(?:\\s*\\d{1,2}:\\d{2})?|前天(?:\\s*\\d{1,2}:\\d{2})?|" +
            "\\d{1,2}\\d{1,2}日.*|\\d{1,2}月\\d{1,2}日.*|\\d{1,2}:\\d{2})$"
    )
    private val PURE_NUMBER = Regex("^\\d{1,3}$")
    private val PERCENT = Regex("^\\d{1,3}%$")

    // 2026-10-07 用户要求：聊天里“对方转发我的动态”必须照常读给模型理解，不能被过滤。
    // 转发动态长这样（真机原文）：
    //   [对方转发了你本人的动态]。动态作者：另一面的我（你本人）。动态正文（你本人发布）：感觉最近状态#情绪 好差啊…
    // 它不是界面垃圾，只是长得像卡片，所以这里明确豁免。
    private val FORWARDED_CARD = Regex("^\\[[^\\]]{0,12}(?:转发|分享|卡片|动态|瞬间|音乐|视频|小程序)[^\\]]{0,12}\\]")

    /** 转发来的卡片/动态：永远不算垃圾，必须留给模型理解。 */
    fun isForwardedCard(content: String): Boolean = FORWARDED_CARD.containsMatchIn(content.trim())

    /** 这条内容长得像界面垃圾（UI 文案 / 时间标签 / 纯数字 / 百分比 / 资料页围观数）。 */
    fun looksJunkShaped(content: String): Boolean {
        val text = content.trim()
        if (text.isEmpty()) return false
        if (isForwardedCard(text)) return false
        // 资料页的围观数（真机读到过 主页 41 条瞬间 / 瞬间 41 / 为您推荐了8个瞬间）
        if (Regex("^(?:主页\\s*)?\\d+\\s*条?\\s*瞬间$|^瞬间\\s*\\d+$").matches(text)) return true
        if (Regex("^为您推荐了\\d+个瞬间$").matches(text)) return true
        if (text in UI_LABELS) return true
        if (PERCENT.matches(text)) return true
        if (TIME_LIKE.matches(text)) return true
        if (PURE_NUMBER.matches(text)) return true
        return false
    }

    /** 整批判断：批量垃圾才剔，零星保留。 */
    fun <T : ChatMessage> filterBatch(messages: List<T>): List<T> {
        if (messages.size < JUNK_BATCH_THRESHOLD) return messages
        val junkCount = messages.count { looksJunkShaped(it.content) }
        if (junkCount < JUNK_BATCH_THRESHOLD) return messages
        return messages.filterNot { looksJunkShaped(it.content) }
    }
}
