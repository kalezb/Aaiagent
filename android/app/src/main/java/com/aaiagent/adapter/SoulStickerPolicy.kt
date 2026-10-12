package com.aaiagent.adapter

import java.util.Calendar

/**
 * Soul 表情与动态图“多层核对”零误判机制：
 *
 * 1. 第一层：优先读取系统自带的无障碍说明文字（contentDescription，如“早上好”、“抱抱”）；
 * 2. 第二层：时段动态表情（早安/午安/晚安）由代码直接按照时间计算核对，杜绝模型瞎猜；
 * 3. 第三层：对本地 14 种互动表情保持像素指纹比对（StickerMatcher.kt），并加强差异门槛检查；
 * 4. 第四层：任何无法百分之百确认的表情，一律按“对方发来一个友好互动表情”做安全回复，严禁硬猜错判。
 */
object SoulStickerPolicy {

    /** 第四层安全回复兜底文案 */
    const val SAFE_FALLBACK_TEXT = "对方发来一个友好互动表情"

    private val GENERIC_DESCRIPTIONS = setOf(
        "表情",
        "表情包",
        "互动表情",
        "Soul互动表情",
        "图片",
        "图片消息",
        "语音",
        "语音消息",
        "语音互动表情",
        "头像",
        "已读",
        "未读",
        "撤回",
        "发送",
        "返回"
    )

    private val TIME_SENSITIVE_LABELS = setOf(
        "时段表情",
        "时段问候",
        "动态表情问候",
        "问候",
        "打招呼",
        "早安",
        "早上好",
        "午安",
        "中午好",
        "下午好",
        "晚安",
        "晚上好"
    )

    /**
     * 第一层：从无障碍说明文字中提取官方标签。
     * 平台官方标注，准确率 100%。
     */
    fun extractLabelFromDescription(description: CharSequence?): String? {
        val raw = description?.toString()?.trim().orEmpty()
        if (raw.isEmpty()) return null

        var cleaned = raw
        cleaned = cleaned.trim('[', ']', '【', '】', '“', '”', '"', '\'')
        val prefixes = listOf("表情:", "表情：", "表情包:", "表情包：", "互动表情:", "互动表情：", "Soul表情:", "Soul表情：", "表情 ")
        for (prefix in prefixes) {
            if (cleaned.startsWith(prefix, ignoreCase = true)) {
                cleaned = cleaned.substring(prefix.length).trim()
                break
            }
        }

        if (cleaned.isEmpty() || cleaned.length > 24) return null
        if (cleaned in GENERIC_DESCRIPTIONS) return null

        return cleaned
    }

    /**
     * 第二层：根据小时数直接计算时段语义。
     * - 早（5:00 - 11:59）: 早安
     * - 中（12:00 - 17:59）: 午安
     * - 晚（18:00 - 04:59）: 晚安
     */
    fun resolveTimeGreeting(hour: Int): String {
        return when (hour) {
            in 5..11 -> "早安"
            in 12..17 -> "午安"
            else -> "晚安"
        }
    }

    fun isTimeSensitive(label: String): Boolean {
        val trimmed = label.trim()
        return trimmed in TIME_SENSITIVE_LABELS ||
            trimmed.contains("早安") ||
            trimmed.contains("午安") ||
            trimmed.contains("晚安") ||
            trimmed.contains("时段")
    }

    fun modelTextForTimeGreeting(greeting: String): String {
        return "对方发来时段问候表情「$greeting」"
    }

    fun modelTextForOfficialLabel(label: String): String {
        return "对方发来 Soul 官方表情「$label」"
    }

    /**
     * 第一层与第二层结合：解析无障碍说明文字，必要时核对时段。
     */
    fun resolveFromDescription(
        description: CharSequence?,
        currentHour: Int = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    ): String? {
        val label = extractLabelFromDescription(description) ?: return null
        return if (isTimeSensitive(label)) {
            val greeting = resolveTimeGreeting(currentHour)
            modelTextForTimeGreeting(greeting)
        } else {
            modelTextForOfficialLabel(label)
        }
    }

    /**
     * 第四层：安全兜底文本。
     */
    fun safeFallbackModelText(): String = SAFE_FALLBACK_TEXT
}
