package com.aaiagent.engine

data class TraceEvent(
    val traceId: String,
    val event: String,
    val platform: String = "",
    val contactId: String = "",
    val stage: String = "",
    val elapsedMs: Long? = null,
    val result: String = "",
    val reason: String = "",
)

object TraceEventCodec {
    fun toJsonLine(event: TraceEvent, timestampMs: Long = System.currentTimeMillis()): String {
        return buildString {
            append('{')
            appendField("timestamp_ms", timestampMs.toString())
            append(',')
            appendField("trace_id", event.traceId)
            append(',')
            appendField("event", event.event)
            append(',')
            appendField("platform", event.platform)
            append(',')
            appendField("contact_id", event.contactId)
            append(',')
            appendField("stage", event.stage)
            append(',')
            appendField("elapsed_ms", event.elapsedMs?.toString().orEmpty())
            append(',')
            appendField("result", event.result)
            append(',')
            appendField("reason", event.reason)
            append('}')
        }
    }

    private fun StringBuilder.appendField(name: String, value: String) {
        append('"')
        append(escape(name))
        append("\":\"")
        append(escape(value))
        append('"')
    }

    private fun escape(value: String): String {
        return buildString(value.length + 8) {
            for (character in value) {
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> {
                        if (character.code < 0x20) {
                            append("\\u")
                            append(character.code.toString(16).padStart(4, '0'))
                        } else {
                            append(character)
                        }
                    }
                }
            }
        }
    }
}
