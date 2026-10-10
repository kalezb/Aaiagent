package com.aaiagent.engine

/**
 * 2026-10-06 用户报的现象：刚给联系人 A 回的话，又出现在联系人 B 的会话里。
 *
 * 发送前的“标题必须一致”校验在正常路径上已经能挡住串台，但那种校验依赖无障碍树；
 * 这里再加一道与页面无关的兜底：同一段比较长的话，短时间内在另一个联系人那里出现过，
 * 就拒绝发送。宁可少发一句，也不要把话说给错的人。
 */
object CrossContactSendGuard {
    /** 只对“够长、能当特征”的话生效，避免把“哈哈”“在呢”这类正常重复误判。 */
    const val MIN_LENGTH = 6
    const val WINDOW_MS = 5 * 60 * 1000L
    /** 内存里最多记这么多条最近发过的话。 */
    const val MAX_RECENT = 40

    data class Sent(val text: String, val contactId: String, val atMs: Long)

    fun normalize(text: String?): String =
        (text ?: "").replace(Regex("[\\s\\u200B-\\u200D\\uFEFF，,。.！!？?~～]+"), "")

    /** 这段话说给这个联系人，最近是否已经说给过别人。 */
    fun isCrossContactRepeat(
        text: String,
        contactId: String,
        recent: List<Sent>,
        nowMs: Long,
    ): Boolean {
        val norm = normalize(text)
        if (norm.length < MIN_LENGTH) return false
        return recent.any { sent ->
            sent.contactId != contactId &&
                sent.contactId.isNotBlank() &&
                nowMs - sent.atMs in 0..WINDOW_MS &&
                normalize(sent.text) == norm
        }
    }

    /** 记一条最近发出去的话（超过上限丢最旧的）。 */
    fun remember(recent: MutableList<Sent>, text: String, contactId: String, nowMs: Long) {
        recent.add(Sent(text = text, contactId = contactId, atMs = nowMs))
        while (recent.size > MAX_RECENT) recent.removeAt(0)
    }
}
