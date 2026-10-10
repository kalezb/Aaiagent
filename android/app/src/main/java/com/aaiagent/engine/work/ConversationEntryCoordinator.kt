package com.aaiagent.engine.work

import com.aaiagent.engine.observability.AutomationPageKind
import com.aaiagent.engine.RuntimeJournal
import kotlinx.coroutines.delay

enum class ConversationEntryState {
    OPENING,
    VERIFIED,
    COMPLETE,
    RETRY_LATER,
    BLOCKED,
}

data class ConversationEntryTask(
    val identity: ConversationIdentity,
    val state: ConversationEntryState,
    val updatedAtMs: Long,
    val nextAttemptAtMs: Long = 0L,
    val attempts: Int = 0,
    val lastReason: String = "",
)

sealed interface ConversationEntryOutcome {
    data object NoWork : ConversationEntryOutcome

    data class PageNotReady(
        val pageKind: AutomationPageKind,
        val reason: String,
    ) : ConversationEntryOutcome

    data class RiskOverlay(
        val reason: String,
        val recoveryAction: String,
        val acted: Boolean,
    ) : ConversationEntryOutcome

    data class Opened(
        val identity: ConversationIdentity,
        val task: ConversationEntryTask,
    ) : ConversationEntryOutcome

    data class RetryLater(
        val identity: ConversationIdentity,
        val task: ConversationEntryTask,
        val reason: String,
    ) : ConversationEntryOutcome

    data class Blocked(
        val identity: ConversationIdentity,
        val task: ConversationEntryTask,
        val reason: String,
    ) : ConversationEntryOutcome
}

/**
 * 只处理当前屏幕上看得见的未读联系人，不自动滚动消息列表。
 */
class ConversationEntryCoordinator(
    private val ui: ConversationUiContract,
    private val clock: () -> Long = System::currentTimeMillis,
    private val verifyAttempts: Int = 20,
    private val verifyDelayMs: Long = 100L,
) {
    private val tasks = linkedMapOf<String, ConversationEntryTask>()
    private val lastServedAtMs = mutableMapOf<String, Long>()

    suspend fun openVisibleNext(
        maxEntries: Int = 12,
        candidateFilter: suspend (ConversationIdentity) -> Boolean = { true },
    ): ConversationEntryOutcome {
        val snapshot = ui.snapshot()
        if (ui.isRiskOverlay(snapshot)) {
            val acted = ui.returnToMessageList()
            return ConversationEntryOutcome.RiskOverlay(
                reason = snapshot.reason,
                recoveryAction = "返回消息列表，不点解除限制或付款",
                acted = acted,
            )
        }
        if (snapshot.pageKind != AutomationPageKind.CONVERSATION_LIST) {
            return ConversationEntryOutcome.PageNotReady(
                pageKind = snapshot.pageKind,
                reason = snapshot.reason,
            )
        }

        val nowMs = clock()
        val visible = ui.scanVisibleUnread(maxEntries.coerceAtLeast(1))
        val allowed = visible.filter { candidate -> candidateFilter(candidate) }
        if (allowed.isEmpty()) {
            return ConversationEntryOutcome.NoWork
        }
        val candidates = allowed.filter { candidate -> shouldTry(candidate, nowMs) }
        if (candidates.isEmpty()) {
            return ConversationEntryOutcome.NoWork
        }
        return openCandidate(candidates, nowMs)
    }

    private suspend fun openCandidate(
        candidates: List<ConversationIdentity>,
        nowMs: Long,
    ): ConversationEntryOutcome {
        val finalSelected = candidates.minByOrNull { candidate ->
            lastServedAtMs[candidate.key] ?: 0L
        } ?: return ConversationEntryOutcome.NoWork

        val opening = ConversationEntryTask(
            identity = finalSelected,
            state = ConversationEntryState.OPENING,
            updatedAtMs = nowMs,
            attempts = (tasks[finalSelected.key]?.attempts ?: 0) + 1,
        )
        tasks[finalSelected.key] = opening

        val opened = ui.openConversation(finalSelected)
        if (!opened.opened) {
            return retry(
                identity = finalSelected,
                task = opening,
                reason = opened.reason.ifBlank { "打开会话失败" },
            )
        }
        val expected = opened.verifiedIdentity ?: finalSelected

        var verified: ConversationOpenResult? = null
        for (attempt in 0 until verifyAttempts.coerceAtLeast(1)) {
            val result = ui.verifyConversation(expected)
            if (result.opened) {
                verified = result
                break
            }
            if (attempt < verifyAttempts - 1) {
                delay(verifyDelayMs.coerceAtLeast(0L))
            }
        }
        if (verified == null) {
            return retry(opening.identity, opening, "聊天页联系人没有确认")
        }

        val verifiedTask = opening.copy(
            identity = expected,
            state = ConversationEntryState.VERIFIED,
            updatedAtMs = clock(),
            nextAttemptAtMs = clock() + VERIFIED_RETRY_COOLDOWN_MS,
            lastReason = "",
        )
        tasks[expected.key] = verifiedTask
        if (expected.key != opening.identity.key) {
            tasks.remove(opening.identity.key)
        }
        return ConversationEntryOutcome.Opened(
            identity = expected,
            task = verifiedTask,
        )
    }

    fun markComplete(identityKey: String) {
        val task = tasks[identityKey] ?: return
        tasks[identityKey] = task.copy(
            state = ConversationEntryState.COMPLETE,
            updatedAtMs = clock(),
            nextAttemptAtMs = 0L,
            lastReason = "",
        )
        lastServedAtMs[identityKey] = clock()
    }

    fun markRetry(identityKey: String, reason: String, delayMs: Long = RETRY_DELAY_MS) {
        val task = tasks[identityKey] ?: return
        tasks[identityKey] = task.copy(
            state = ConversationEntryState.RETRY_LATER,
            updatedAtMs = clock(),
            nextAttemptAtMs = clock() + delayMs.coerceAtLeast(0L),
            lastReason = reason.take(240),
        )
    }

    fun taskSnapshot(): List<ConversationEntryTask> = tasks.values.toList()

    private fun shouldTry(identity: ConversationIdentity, nowMs: Long): Boolean {
        val task = tasks[identity.key] ?: run {
            // 没被 task 追踪过，但可能刚被回复过（上一次生命周期里记的 lastServedAtMs）
            val servedAt = lastServedAtMs[identity.key] ?: return true
            return nowMs - servedAt >= MIN_RESERVE_GAP_MS
        }
        return when (task.state) {
            ConversationEntryState.COMPLETE,
            ConversationEntryState.BLOCKED,
            -> {
                // 已完成/已阻止：如果冷却期过了，允许重新进入
                val servedAt = lastServedAtMs[identity.key] ?: return false
                nowMs - servedAt >= MIN_RESERVE_GAP_MS
            }
            ConversationEntryState.RETRY_LATER ->
                nowMs >= task.nextAttemptAtMs
            ConversationEntryState.VERIFIED ->
                nowMs >= task.nextAttemptAtMs
            ConversationEntryState.OPENING -> false
        }
    }

    private fun retry(
        identity: ConversationIdentity,
        task: ConversationEntryTask,
        reason: String,
    ): ConversationEntryOutcome {
        val next = task.copy(
            state = ConversationEntryState.RETRY_LATER,
            updatedAtMs = clock(),
            nextAttemptAtMs = clock() + RETRY_DELAY_MS,
            lastReason = reason.take(240),
        )
        tasks[identity.key] = next
        return ConversationEntryOutcome.RetryLater(
            identity = identity,
            task = next,
            reason = reason,
        )
    }

    private companion object {
        const val RETRY_DELAY_MS = 15_000L
        const val VERIFIED_RETRY_COOLDOWN_MS = 60_000L
        /** 回复完一个人后至少等这么久才能再回他，防止活跃联系人霸占列表。 */
        const val MIN_RESERVE_GAP_MS = 60_000L
    }

}
