package com.aaiagent.engine.work

fun interface ConversationShadowProbe {
    suspend fun probeOnce(): ConversationOrchestrationOutcome
}

/**
 * 影子观察器只记录新流程的判断，不执行任何页面动作。
 */
class ConversationShadowObserver(
    private val probe: ConversationShadowProbe,
    private val report: (step: String, detail: String) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val repeatWindowMs: Long = 30_000L,
) {
    private var lastKey: String = ""
    private var lastReportedAtMs: Long = Long.MIN_VALUE

    suspend fun observeOnce(): ConversationOrchestrationOutcome {
        val outcome = probe.probeOnce()
        val key = reportKey(outcome)
        if (key.isBlank()) return outcome
        val nowMs = clock()
        val repeatedTooSoon = key == lastKey &&
            nowMs - lastReportedAtMs < repeatWindowMs.coerceAtLeast(0L)
        if (repeatedTooSoon) return outcome
        lastKey = key
        lastReportedAtMs = nowMs
        report("影子新流程", describe(outcome))
        return outcome
    }

    private fun reportKey(outcome: ConversationOrchestrationOutcome): String {
        return when (outcome) {
            ConversationOrchestrationOutcome.NoUnreadWork -> ""
            is ConversationOrchestrationOutcome.PageNotReady -> ""
            is ConversationOrchestrationOutcome.RiskOverlay ->
                "risk:${outcome.reason}:${outcome.recoveryAction}"
            is ConversationOrchestrationOutcome.ShadowDecision ->
                "shadow:${outcome.identity.key}"
            is ConversationOrchestrationOutcome.Completed ->
                "completed:${outcome.identity.key}"
            is ConversationOrchestrationOutcome.RetryLater ->
                "retry:${outcome.identity.key}:${outcome.reason}"
            is ConversationOrchestrationOutcome.Blocked ->
                "blocked:${outcome.identity.key}:${outcome.reason}"
        }
    }

    private fun describe(outcome: ConversationOrchestrationOutcome): String {
        return when (outcome) {
            ConversationOrchestrationOutcome.NoUnreadWork -> "没有可见未读"
            is ConversationOrchestrationOutcome.PageNotReady ->
                "当前页面不是消息列表 page=${outcome.pageKind} reason=${outcome.reason}"
            is ConversationOrchestrationOutcome.RiskOverlay ->
                "发现风险弹窗 reason=${outcome.reason} " +
                    "建议=${outcome.recoveryAction} 已执行=${outcome.acted}"
            is ConversationOrchestrationOutcome.ShadowDecision ->
                "建议打开=${outcome.identity.displayName} " +
                    "身份=${outcome.identity.key} 页码=${outcome.identity.pageIndex} " +
                    "预览=${outcome.identity.preview.take(40)} 不点击"
            is ConversationOrchestrationOutcome.Completed ->
                "完成=${outcome.identity.displayName} 段数=${outcome.replyParts}"
            is ConversationOrchestrationOutcome.RetryLater ->
                "稍后重试=${outcome.identity.displayName} 原因=${outcome.reason}"
            is ConversationOrchestrationOutcome.Blocked ->
                "已拦下=${outcome.identity.displayName} 原因=${outcome.reason}"
        }
    }
}
