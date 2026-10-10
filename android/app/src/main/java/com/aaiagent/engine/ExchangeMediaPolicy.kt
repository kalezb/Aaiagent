package com.aaiagent.engine

object ExchangeMediaPolicy {
    const val DAILY_GROUP_ID = "daily"
    const val FILE_NAME = "aaiagent_exchange_daily.jpg"
    const val CONTENT_TYPE = "image/jpeg"

    fun requestId(contactId: String, identityKey: String, content: String): String {
        val stableValue = listOf(
            contactId.trim(),
            identityKey.trim().ifBlank { content.trim() }
        ).joinToString("\u001F")
        return "exchange-" + IncomingMessageTracker.fingerprint(stableValue)
    }

    fun shouldStageDaily(mode: HostingMode): Boolean {
        return mode == HostingMode.FULL_AUTO
    }

    /**
     * 后端把这次以图换图判成 `skip` 之后，还要不要重试？
     *
     * **不要。** `skip` 是最终答复 —— 重试一万次它还是 skip。
     *
     * 真机事故（2026-10-06 19:01）：后端因为人设不在"日常照"的开放范围里，
     * 对每一次以图换图都回 `skip`；而代码把它当成"媒体还没加载好"，
     * 于是每 6 秒重来一次、**无限循环**，白白耗电，聊天页也一直被它占着。
     *
     * 判成"不重试"之后，流程会继续往下走 —— 她会用文字/语音回应对方，
     * 总比什么都不发、一直在后台空转强。
     */
    fun shouldRetryAfterSelection(action: String?): Boolean =
        action?.trim()?.lowercase() != "skip"
}
