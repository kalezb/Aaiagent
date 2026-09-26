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
    private val timestampPrefix = Regex("""^\[[^\]\r\n]{0,100}(?::\d{2}|距今约\d+小时)[^\]\r\n]{0,100}]\s*""")

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
                .replace(timestampPrefix, "")
                .trimStart()
            if (reply == before) break
        }
        return reply.trim()
    }
}
