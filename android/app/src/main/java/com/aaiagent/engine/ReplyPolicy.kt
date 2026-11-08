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
    /** 消息已经放了这么久（安静窗口 + 余量），就不用再等对方"不连着发"。 */
    const val SETTLE_GRACE_MS = 2_000L

    /**
     * A turn is not sent to the model from the first page read.
     * We always take one more read so late-arriving messages from the same
     * conversation batch cannot slip into a second generation.
     */
    fun shouldConfirmStableBatch(): Boolean = true

    /**
     * 对方这条消息是不是早就放着了（不是刚发出来）。
     *
     * 2026-11-03 真机计时：等待"对方不连着发"的那段循环，每轮要整页重读两次，
     * 实测占掉 2.9~4.9 秒；而真正在回的消息，绝大多数都放了几十秒以上。
     * 只有刚发出来的才需要等，免得一句话拆两半回。
     */
    fun hasSettled(
        lastIncomingAtMs: Long?,
        timestampTrusted: Boolean,
        nowMs: Long,
    ): Boolean {
        if (!timestampTrusted) return false
        val at = lastIncomingAtMs ?: return false
        if (at <= 0L) return false
        return nowMs - at >= INITIAL_MERGE_DELAY_MS + SETTLE_GRACE_MS
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
