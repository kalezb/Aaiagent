package com.aaiagent.engine

/**
 * Soul reports a bubble as incoming whenever its avatars and bubble geometry
 * cannot be resolved. If that text is something the automation already sent in
 * this conversation, trusting the fallback would make the agent answer its own
 * message, so the bubble has to be recognised as ours instead.
 *
 * 2026-10-06 真机（♩讲究郎¶吾先森（89已婚））：平台把她的三段长消息重新渲染/截断后，
 * 读回来的只是其中一截（"你想拿什么换" vs 发出的"想看我 那得先说说你拿什么换"），
 * 原来要求整句完全相同，于是没认出来 → 同一句被回了两遍。
 * 现在补上片段匹配：去掉空白后，一方完整包含另一方，或存在足够长的连续相同片段，都算自己说过的话。
 */
object UndetectedOwnBubblePolicy {
    /** 片段匹配门槛：至少这么长的连续相同文字才算“自己说过的话”。 */
    private const val MIN_SHARED_RUN = 5

    fun isOwnBubble(
        sender: String?,
        type: String?,
        content: String?,
        sentByAutomation: Set<String>,
    ): Boolean {
        if (sender == "self") return false
        val normalizedType = type?.trim().orEmpty()
        if (normalizedType != "text") return false
        val text = normalize(content)
        if (text.isEmpty()) return false
        return sentByAutomation.any { sent -> matches(normalize(sent), text) }
    }

    private fun matches(sent: String, text: String): Boolean {
        if (sent.isEmpty() || text.isEmpty()) return false
        if (sent == text) return true
        // 2026-10-07 真机（行者）：他的消息“27”“当然”“我上的是夜班”被当成她自己说过的话，
        // 整条会话因此判成“无需回复”直接退出。原因就是下面的“包含”匹配太宽：
        // 短消息很容易撞上她长句里的一小截。现在短消息不再做包含匹配。
        if (minOf(sent.length, text.length) < MIN_SHARED_RUN) return false
        if (sent.contains(text) || text.contains(sent)) return true
        return longestCommonRun(sent, text) >= MIN_SHARED_RUN
    }

    private fun normalize(value: String?): String =
        value?.replace(Regex("\\s+"), "")?.trim().orEmpty()

    /** 最长公共子串长度（两串都很短，直接一维 DP）。 */
    private fun longestCommonRun(a: String, b: String): Int {
        if (a.isEmpty() || b.isEmpty()) return 0
        val previous = IntArray(b.length + 1)
        val current = IntArray(b.length + 1)
        var best = 0
        for (i in 1..a.length) {
            for (j in 1..b.length) {
                current[j] = if (a[i - 1] == b[j - 1]) previous[j - 1] + 1 else 0
                if (current[j] > best) best = current[j]
            }
            for (j in 0..b.length) previous[j] = current[j]
        }
        return best
    }
}
