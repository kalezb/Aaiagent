package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulSystemNoticePolicy

/**
 * 判断这一轮读到的聊天内容和列表里的最新预览是否一致。
 *
 * 真机问题（2026-10-05）：聊天页打开时不一定停在底部，只读可见气泡会读到旧窗口——
 * 同一段对话三次读到的“最后一条”分别是第 1、2、4 句，于是同一批消息被回了 4 次。
 *
 * 注意：列表预览和气泡内容格式本来就常常不同（表情显示成 [呲牙笑]、互动显示成“弹了弹我”），
 * 所以这个判断只当“提示”用，不能当“判据”——对不上时重滚一次，仍对不上就交给
 * “这条消息回过了吗”兜底，绝不因此拒绝回复。
 */
object ChatReadFreshnessPolicy {
    fun matches(
        messages: List<PlatformAdapter.ChatMessage>,
        listPreview: String
    ): Boolean {
        val preview = normalize(listPreview)
        if (preview.isEmpty()) return true
        val last = normalize(messages.lastOrNull()?.content.orEmpty())
        if (last.isEmpty()) return true
        if (preview == "[语音]" && last.contains("语音转文字")) return true
        // 读到的只是一条系统/互动提示时，本来就没有可比的气泡内容。
        if (SoulSystemNoticePolicy.isNotice(last)) return true
        // 列表预览可能是被截断的一句（带省略号），所以只比前缀，不比全长。
        val probe = minOf(preview.length, last.length, HEAD_CHARS)
        if (probe <= 0) return true
        return preview.take(probe) == last.take(probe)
    }

    private fun normalize(value: String): String {
        return value
            .replace(INTERACTION_NOTICE, "")
            .replace(EMOJI_CODE, "")
            .replace(Regex("\\s+"), "")
            .trim()
            .trimEnd('…', '.', '。', '·', '~')
    }

    // 表情代号：Soul 列表里显示成 [呲牙笑]、[捂脸哭] 这类，气泡里是渲染后的文本。
    private val EMOJI_CODE = Regex("\\[[^\\]\\n]{1,10}\\]")
    // 互动提示：列表里显示“xxx 弹了弹我”，气泡里是“对方发来 Soul 互动表情…”。
    private val INTERACTION_NOTICE = Regex("(?:弹了弹我|拍了拍我|戳了戳我|对方发来\\s*Soul\\s*互动表情[^\\n]*)")

    private const val HEAD_CHARS = 24
}
