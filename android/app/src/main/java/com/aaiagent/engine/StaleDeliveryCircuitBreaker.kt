package com.aaiagent.engine

internal object StaleDeliveryCircuitBreaker {
    fun shouldSkip(
        context: ConversationContext,
        batchFingerprint: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Boolean {
        val skip = synchronized(context) {
            context.shouldSkipPausedStaleDelivery(batchFingerprint, nowMs)
        }
        if (!skip) return false
        synchronized(context) {
            context.lastIgnoredIncomingFingerprint = batchFingerprint
        }
        RuntimeJournal.recovery(
            "同一批消息仍在发送失败暂停期内，跳过重复生成 contact=${context.contactName}"
        )
        return true
    }

    fun recordFailure(
        context: ConversationContext,
        batchFingerprint: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Int {
        val failures = synchronized(context) {
            context.recordStaleDeliveryFailure(batchFingerprint, nowMs)
        }
        if (failures == ConversationContext.STALE_DELIVERY_MAX_FAILURES) {
            synchronized(context) {
                context.lastIgnoredIncomingFingerprint = batchFingerprint
            }
            RuntimeJournal.recovery("同一批消息连续发送失败${failures}次，暂停10分钟 contact=${context.contactName}")
        }
        return failures
    }

    fun clear(context: ConversationContext) {
        synchronized(context) {
            context.clearStaleDeliveryFailures()
        }
    }
}
