package com.aaiagent.engine

/**
 * Removes role and timestamp markers that the model may copy from prompt context.
 * Cleanup is deliberately limited to line/segment starts so ordinary phrases
 * such as "你说呢" are not modified.
 */
object AssistantReplySanitizer {
    private val segmentSeparator = Regex("\\r?\\n|\\|\\|\\|")
    private val contextPrefix = Regex("""^\[[^\]\r\n]{1,100}]\s*(?:你说|对方说|我说|对方|我)\s*[：:]\s*""")
    private val speakerPrefix = Regex("""^(?:你说|对方说|我说|对方|我)\s*[：:]\s*""")
    private val embeddedSpeakerLabel = Regex("""(?:你说|对方说|我说|对方|我)\s*[：:]\s*""")
    private val timestampPrefix = Regex("""^\[[^\]\r\n]{0,100}(?::\d{2}|距今约\d+小时)[^\]\r\n]{0,100}]\s*""")

    private val leakedDatedMarker = Regex("""\[[^\]\r\n]{0,40}\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}[^\]\r\n]{0,20}]\s*""")
    private val leakedClockMarker = Regex("""\[[^\]\r\n]{0,20}\d{1,2}:\d{2}[^\]\r\n]{0,20}]\s*""")

    /**
     * 系统内部标记的**完整清单** —— 只在这一处维护，测试会逐个验证。
     *
     * 这些是程序自己的记号，**不是人说的话**。取消息时用它们标注气泡类型
     * （见 SoulAdapter.readMessages）：
     *   [语音] [语音互动表情] [图片] [闪照] [视频] [表情] [Soul互动表情]
     *   [以图换图] [文件] [链接] [音乐] [位置] [名片] [转账] [红包]
     *
     * 带上它们是为了让测试能一条不漏地钉死 —— 漏一个就是一次穿帮。
     */
    val INTERNAL_MARKERS: List<String> = listOf(
        "[语音]", "[语音互动表情]", "[图片]", "[闪照]", "[视频]",
        "[表情]", "[Soul互动表情]", "[以图换图]", "[文件]", "[链接]",
        "[音乐]", "[位置]", "[名片]", "[转账]", "[红包]",
    )

    /**
     * 带参数的内部标记，比如后端"待发媒体"时返回的 `[图片:daily_04]`。
     *
     * 这是最危险的一种：**现有过滤完全挡不住它**（之前只认 `[图片]` 这种空形式）。
     * 真机上它出现在换图那条路里，一旦被当成"要说的话"发出去，
     * 对方就会看到 `[图片:daily_04]` —— 直接穿帮。
     */
    private val parameterizedMarker =
        Regex("""\[(?:图片|视频|语音|文件)[:：][^\[\]\r\n]{1,64}]""")

    /**
     * 不带参数的内部标记。
     *
     * 两条硬规矩：
     * 1. **不论出现在句首还是句子中间，一律剔除** —— 大模型会从上下文里照抄，
     *    漏在中间对方照样会看到方括号；
     * 2. 剔完如果什么都不剩，这条**整条不发** —— `sendReply` 里判空拦截，
     *    并记一行日志。宁可这次不发，也不能让记号出去。
     *
     * 只认上面清单里的词，不碰普通方括号（比如句子里的【重点】）。
     */
    private val internalMarker = Regex(
        """\[(?:语音互动表情|Soul互动表情|以图换图|语音|图片|视频|表情|文件|链接|音乐|位置|名片|转账|红包|闪照)]"""
    )

    /** 剔除标记后可能留下连续空格，压成一个，免得回复里出现怪缝。 */
    private val repeatedSpaces = Regex("""[ \t]{2,}""")

    fun clean(value: String?): String {
        return value.orEmpty()
            .split(segmentSeparator)
            .map(::cleanSegment)
            .filter { it.isNotEmpty() }
            .joinToString("\n")
    }

    fun cleanSegment(value: String?): String {
        var reply = value.orEmpty().trim()
        while (reply.isNotEmpty()) {
            val before = reply
            reply = reply
                .replace(contextPrefix, "")
                .replace(speakerPrefix, "")
                .replace(embeddedSpeakerLabel, " ")
                .replace(timestampPrefix, "")
                .replace(leakedDatedMarker, "")
                .replace(leakedClockMarker, "")
                .replace(parameterizedMarker, "")
                .replace(internalMarker, "")
                .replace(repeatedSpaces, " ")
                .trim()
            if (reply == before) break
        }
        return reply.trim()
    }
}
