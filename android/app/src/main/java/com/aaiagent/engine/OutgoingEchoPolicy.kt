package com.aaiagent.engine

/**
 * 2026-10-07 真机（稳重的神盾局特工）：同一条回复发了两遍——
 * 第一次其实已经发出去了，但发送验证没在可见消息里看到它（新消息还在屏幕下方），
 * 于是判成 NOT_VERIFIED，几秒后从“待处理回复”里又发了一遍。
 *
 * 这里加一道防线：发送之前先看聊天里最近几条，如果这句刚刚已经发出去了，就不再发。
 * 只看最近几条，是为了不误伤“过一会儿又说同一句话”的正常情况。
 */
object OutgoingEchoPolicy {
    /** 只看最近几条自己发的话：太靠前的不算“刚发过”。 */
    const val RECENT_SELF_WINDOW = 2

    fun alreadyJustSent(
        text: String,
        recentSelfMessages: List<String>,
    ): Boolean {
        val expected = compact(text)
        if (expected.isEmpty()) return false
        return recentSelfMessages
            .takeLast(RECENT_SELF_WINDOW)
            .any { compact(it) == expected }
    }

    private fun compact(value: String?): String =
        value?.replace(Regex("\\s+"), "")?.trim().orEmpty()
}
