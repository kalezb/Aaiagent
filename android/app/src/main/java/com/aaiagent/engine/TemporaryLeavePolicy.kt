package com.aaiagent.engine

import kotlin.random.Random

data class TemporaryLeaveDecision(
    val reason: String,
    val durationMs: Long
)

object TemporaryLeavePolicy {
    fun detect(
        text: String,
        randomUnit: Double = Random.nextDouble()
    ): TemporaryLeaveDecision? {
        val normalized = text
            .trim()
            .replace(Regex("\\s+"), "")
            .replace('，', ',')
        if (normalized.isEmpty()) return null

        val random = randomUnit.coerceIn(0.0, 1.0)
        return when {
            hasAny(normalized, WASH_FUTURE) ->
                TemporaryLeaveDecision("洗漱", durationMinutes(18, 30, random))

            hasAny(normalized, BUSY_FUTURE) ->
                TemporaryLeaveDecision("忙碌", durationMinutes(18, 40, random))

            hasAny(normalized, MEAL_FUTURE) ->
                TemporaryLeaveDecision("吃饭", durationMinutes(25, 50, random))

            hasAny(normalized, OUTING_FUTURE) ->
                TemporaryLeaveDecision("外出", durationMinutes(35, 70, random))

            hasAny(normalized, SLEEP_FUTURE) ->
                TemporaryLeaveDecision("休息", durationHours(7, 9, random))

            hasAny(normalized, GENERIC_DEFER) ->
                TemporaryLeaveDecision("稍后聊", durationMinutes(8, 15, random))

            else -> null
        }
    }

    private fun hasAny(text: String, markers: List<String>): Boolean {
        return markers.any(text::contains)
    }

    private fun durationMinutes(min: Int, max: Int, random: Double): Long {
        val minutes = min + ((max - min) * random).toInt()
        return minutes * 60_000L
    }

    private fun durationHours(min: Int, max: Int, random: Double): Long {
        val minutes = min * 60 + ((max - min) * 60 * random).toInt()
        return minutes * 60_000L
    }

    private val WASH_FUTURE = listOf(
        "去洗澡", "去洗漱", "洗个澡", "洗漱去", "洗澡去",
        "先去洗", "洗一下", "洗完澡再聊", "洗完再聊", "洗好再聊"
    )

    private val BUSY_FUTURE = listOf(
        "去忙", "先忙", "忙一下", "忙会儿", "忙点事", "处理点事",
        "去工作", "上班去", "去上班", "去开会", "开会去"
    )

    private val MEAL_FUTURE = listOf(
        "去吃饭", "吃饭去", "先吃饭", "吃个饭", "去吃个饭"
    )

    private val OUTING_FUTURE = listOf(
        "出门", "出去一下", "出去一趟", "去客户", "上门", "在路上", "开车去"
    )

    private val SLEEP_FUTURE = listOf(
        "去睡觉", "睡觉去", "睡了", "晚安", "休息了", "明早聊", "明天聊"
    )

    private val GENERIC_DEFER = listOf(
        "一会儿聊", "等会儿聊", "等会聊", "待会聊", "晚点聊", "回头聊", "稍后聊"
    )
}
