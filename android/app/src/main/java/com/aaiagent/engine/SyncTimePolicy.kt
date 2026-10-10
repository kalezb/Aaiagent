package com.aaiagent.engine

/**
 * 2026-10-07（方案 B）：Soul 只在时间有间隔的地方显示时间标签，
 * 连发的几条读不到各自的时间，以前会写成 0，后端就按“同步时刻”记，
 * 结果云端顺序/时间和手机上的真实对话对不上。
 *
 * 这里给缺时间的消息补一个时间：以最后一条已知时间为锚点，按顺序每条差 1 秒。
 * 锚点后面（更新的）递增，锚点前面（更早的）递减；整批都没有锚点时，以“现在”为最后一条往前推。
 */
object SyncTimePolicy {
    const val STEP_MS = 1000L

    fun deriveSeconds(millisList: List<Long?>, nowMs: Long): List<Long> {
        if (millisList.isEmpty()) return emptyList()
        val knownIndex = millisList.indexOfLast { it != null && it > 0L }
        val anchorIndex = if (knownIndex >= 0) knownIndex else millisList.size - 1
        val anchorMs = millisList.getOrNull(anchorIndex)?.takeIf { it > 0L } ?: nowMs
        return millisList.mapIndexed { index, value ->
            val ms = value?.takeIf { it > 0L }
                ?: (anchorMs + (index - anchorIndex) * STEP_MS)
            ms / 1000L
        }
    }
}
