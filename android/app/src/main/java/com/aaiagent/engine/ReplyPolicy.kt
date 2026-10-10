package com.aaiagent.engine

enum class ReplyFreshnessDecision {
    KEEP,
    RECOMPUTE,
    ABORT_STALE
}

enum class InitialMergeDecision {
    WAIT,
    READY,
    TIMEOUT
}

object ReplyFreshnessPolicy {
    const val INITIAL_MERGE_DELAY_MS = 900L
    const val INITIAL_MERGE_POLL_MS = 200L
    const val INITIAL_MERGE_MAX_WAIT_MS = 5_000L
    const val BURST_MERGE_DELAY_MS = 2_500L
    const val BURST_MERGE_MAX_WAIT_MS = 10_000L

    /** 对方消息还热乎（刚发出来）才值得等合并窗口，超过这个时长就不用等了。 */
    const val FRESH_MESSAGE_GRACE_MS = 3_000L

    /**
     * 要不要等“对方可能还在连着发”的合并窗口。
     *
     * 真机问题（2026-10-05）：回复慢的主因就是这个窗口——一批两条消息时静默窗口 2.5 秒，
     * 每轮还要重读整棵消息树，实测手机端在发请求前先花了 4~6 秒。
     * 但绝大多数情况是在回几分钟甚至几小时前的未读，根本不存在“对方还在打字”，
     * 这种就直接发请求；只有消息刚发出来（3 秒内）才等窗口。
     */
    fun shouldWaitForMerge(
        newestIncomingAgeMs: Long,
        graceMs: Long = FRESH_MESSAGE_GRACE_MS,
    ): Boolean {
        if (newestIncomingAgeMs < 0L) return true
        return newestIncomingAgeMs < graceMs
    }

    fun initialMergeDecision(
        startedAtMs: Long,
        lastChangeAtMs: Long,
        nowMs: Long,
        quietWindowMs: Long = INITIAL_MERGE_DELAY_MS,
        maxWaitMs: Long = INITIAL_MERGE_MAX_WAIT_MS,
        burstCount: Int = 1,
    ): InitialMergeDecision {
        val isBurst = burstCount > 1
        val effectiveQuietWindowMs = if (isBurst) BURST_MERGE_DELAY_MS else quietWindowMs
        val effectiveMaxWaitMs = if (isBurst) BURST_MERGE_MAX_WAIT_MS else maxWaitMs
        if (startedAtMs > 0L && nowMs - startedAtMs >= effectiveMaxWaitMs) {
            return InitialMergeDecision.TIMEOUT
        }
        if (lastChangeAtMs > 0L && nowMs - lastChangeAtMs >= effectiveQuietWindowMs) {
            return InitialMergeDecision.READY
        }
        return InitialMergeDecision.WAIT
    }

    fun canAcceptRecomputedReply(requestId: Int, currentRequestId: Int): Boolean {
        return requestId == currentRequestId
    }

    fun shouldQueueRetryAfterAbort(decision: ReplyFreshnessDecision): Boolean {
        return decision == ReplyFreshnessDecision.ABORT_STALE
    }

    fun decide(
        requestId: Int,
        currentRequestId: Int,
        recalcCount: Int,
        firstMessageAtMs: Long,
        nowMs: Long,
        maxRecalc: Int = 3,
        // 2026-10-05：原来 8 秒。实测一轮回复光模型就要 5~7 秒，稍慢一点就被判过期作废，
        // 用户看到的就是“不回消息还退出”。放宽到 20 秒，仍然能拦住“生成期间又来了新消息”。
        maxWaitMs: Long = 20_000L
    ): ReplyFreshnessDecision {
        if (requestId == currentRequestId) return ReplyFreshnessDecision.KEEP
        val expired = firstMessageAtMs > 0L && nowMs - firstMessageAtMs >= maxWaitMs
        if (recalcCount >= maxRecalc || expired) return ReplyFreshnessDecision.ABORT_STALE
        return ReplyFreshnessDecision.RECOMPUTE
    }
}

object IncomingMessageTracker {
    fun fingerprint(content: String): String = content.trim().replace(Regex("\\s+"), " ")

    fun isNew(previousFingerprint: String, content: String): Boolean {
        val current = fingerprint(content)
        return current.isNotEmpty() && current != previousFingerprint
    }
}
