package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter

/**
 * 2026-10-07 真机（稳重的神盾局特工）：同一条回复发了两遍——
 * 第一次其实已经发出去了，但发送验证没在可见消息里看到它（新消息还在屏幕下方），
 * 于是判成 NOT_VERIFIED，几秒后从“待处理回复”里又发了一遍。
 *
 * 这里加一道防线：发送之前先看聊天里最近几条，如果这句刚刚已经发出去了，就不再发。
 *
 * 2026-11-03 真机（00:17，小张晨）：这道防线反过来咬了自己——模型三分钟前说过“嘴上这么甜”，
 * 这次又说了一遍，程序判成“刚发过”直接跳过，还记成发送成功。客户一个字都没收到，
 * 云端却记成了已送达。
 *
 * 所以现在多一个条件：只有这句话之后**对方再没说过话**，才算我们自己刚发出去、没验证到的回声。
 * 对方已经接了话，就说明这是新的一轮，必须真发出去。
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

    /**
     * 所有平台共用的发送前判断：这句话是不是我们自己刚发出去、只是没验证到的回声。
     *
     * @param visibleMessages 聊天页上看得见的所有气泡，按时间顺序（最后一条最新）。
     */
    fun shouldSkipSend(
        text: String,
        visibleMessages: List<PlatformAdapter.ChatMessage>,
    ): Boolean {
        val expected = compact(text)
        if (expected.isEmpty()) return false

        val selfSlots = visibleMessages.indices.filter { visibleMessages[it].sender == "self" }
        val matchSlot = selfSlots
            .takeLast(RECENT_SELF_WINDOW)
            .lastOrNull { compact(visibleMessages[it].content) == expected }
            ?: return false

        // 对方在这句之后说过话，就说明已经是新的一轮，绝不能当成回声吞掉。
        return visibleMessages.drop(matchSlot + 1).none { it.sender != "self" }
    }

    private fun compact(value: String?): String =
        value?.replace(Regex("\\s+"), "")?.trim().orEmpty()
}
