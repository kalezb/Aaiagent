package com.aaiagent.engine.work

import com.aaiagent.engine.observability.AutomationPageKind
import kotlinx.coroutines.delay

data class ConversationReplyPlan(
    val parts: List<String>,
    val reason: String = "",
) {
    val isEmpty: Boolean get() = parts.none { it.isNotBlank() }
}

fun interface ConversationReplyPlanner {
    suspend fun plan(
        identity: ConversationIdentity,
        readResult: ConversationReadResult,
    ): ConversationReplyPlan
}

sealed interface ConversationOrchestrationOutcome {
    data object NoUnreadWork : ConversationOrchestrationOutcome

    data class PageNotReady(
        val pageKind: AutomationPageKind,
        val reason: String,
    ) : ConversationOrchestrationOutcome

    data class RiskOverlay(
        val reason: String,
        val recoveryAction: String,
        val acted: Boolean,
    ) : ConversationOrchestrationOutcome

    data class ShadowDecision(
        val identity: ConversationIdentity,
        val item: ConversationWorkItem,
        val plannedAction: String,
        val reason: String,
    ) : ConversationOrchestrationOutcome

    data class Completed(
        val identity: ConversationIdentity,
        val item: ConversationWorkItem,
        val replyParts: Int,
    ) : ConversationOrchestrationOutcome

    data class RetryLater(
        val identity: ConversationIdentity,
        val item: ConversationWorkItem,
        val reason: String,
    ) : ConversationOrchestrationOutcome

    data class Blocked(
        val identity: ConversationIdentity,
        val item: ConversationWorkItem,
        val reason: String,
    ) : ConversationOrchestrationOutcome
}

/**
 * 新消息总调度器。
 *
 * 它只认 [ConversationUiContract] 和 [ConversationReplyPlanner]，不认识任何平台控件。
 * shadowMode=true 时只计算下一步，不点击、不发送，用于和旧流程对照。
 */
class ConversationOrchestrator(
    private val ui: ConversationUiContract,
    private val planner: ConversationReplyPlanner,
    private val shadowMode: Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
    private val verifyAttempts: Int = 20,
    private val verifyDelayMs: Long = 100L,
) {
    private val tasks = linkedMapOf<String, ConversationWorkItem>()

    suspend fun processNext(maxEntries: Int = 10): ConversationOrchestrationOutcome {
        val snapshot = ui.snapshot()
        if (ui.isRiskOverlay(snapshot)) {
            val acted = if (shadowMode) {
                false
            } else {
                ui.returnToMessageList()
            }
            return ConversationOrchestrationOutcome.RiskOverlay(
                reason = snapshot.reason,
                recoveryAction = "返回消息列表，不点解除限制或付款",
                acted = acted,
            )
        }
        if (snapshot.pageKind != AutomationPageKind.CONVERSATION_LIST) {
            return ConversationOrchestrationOutcome.PageNotReady(
                pageKind = snapshot.pageKind,
                reason = snapshot.reason,
            )
        }

        val nowMs = clock()
        val identities = if (shadowMode) {
            ui.scanVisibleUnread(maxEntries.coerceAtLeast(1))
        } else {
            ui.scanUnread(maxEntries.coerceAtLeast(1))
        }
        val next = identities.firstOrNull { identity ->
            val previous = tasks[identity.key]
            previous == null || when (previous.state) {
                ConversationWorkState.COMPLETE,
                ConversationWorkState.BLOCKED,
                -> false
                ConversationWorkState.RETRY_LATER -> nowMs >= previous.nextAttemptAtMs
                else -> true
            }
        } ?: return ConversationOrchestrationOutcome.NoUnreadWork

        if (shadowMode) {
            val discovered = ConversationWorkItem(
                identity = next,
                discoveredAtMs = nowMs,
            )
            val opened = move(discovered, ConversationWorkEvent.OpenRequested, nowMs)
            if (!opened.accepted) {
                return ConversationOrchestrationOutcome.Blocked(
                    identity = next,
                    item = opened.item,
                    reason = opened.reason,
                )
            }
            return ConversationOrchestrationOutcome.ShadowDecision(
                identity = next,
                item = opened.item,
                plannedAction = "OPEN",
                reason = "影子模式：只计算应该打开这个联系人，不执行点击",
            )
        }

        val existing = tasks[next.key]
        val discovered = existing ?: ConversationWorkItem(
            identity = next,
            discoveredAtMs = nowMs,
        )
        val opened = move(discovered, ConversationWorkEvent.OpenRequested, nowMs)
        if (!opened.accepted) {
            tasks[next.key] = opened.item
            return ConversationOrchestrationOutcome.Blocked(
                identity = next,
                item = opened.item,
                reason = opened.reason,
            )
        }
        tasks[next.key] = opened.item

        return execute(opened.item)
    }

    fun taskSnapshot(): List<ConversationWorkItem> = tasks.values.toList()

    private suspend fun execute(initial: ConversationWorkItem): ConversationOrchestrationOutcome {
        var item = initial
        val openResult = ui.openConversation(item.identity)
        if (!openResult.opened) {
            return retry(item, openResult.reason.ifBlank { "打开会话失败" })
        }
        val expected = openResult.verifiedIdentity ?: item.identity

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
            return retry(item, "聊天页联系人没有确认")
        }
        item = move(item, ConversationWorkEvent.ChatVerified, clock()).item
        tasks[item.identity.key] = item

        val readResult = ui.readLatestMessages()
        if (!readResult.read) {
            return retry(item, readResult.reason.ifBlank { "读取消息失败" })
        }
        item = move(item, ConversationWorkEvent.ReadCompleted, clock()).item
        tasks[item.identity.key] = item

        val plan = planner.plan(item.identity, readResult)
        val parts = plan.parts.map(String::trim).filter(String::isNotEmpty)
        if (parts.isEmpty()) {
            val returned = ui.returnToMessageList()
            return if (returned) {
                item = move(
                    item,
                    ConversationWorkEvent.ReplyNotNeeded(plan.reason),
                    clock(),
                ).item
                tasks[item.identity.key] = item
                ConversationOrchestrationOutcome.Completed(
                    identity = item.identity,
                    item = item,
                    replyParts = 0,
                )
            } else {
                blocked(item, "没有待回复内容，但没能回到消息列表")
            }
        }

        item = move(item, ConversationWorkEvent.ReplyReady, clock()).item
        item = move(item, ConversationWorkEvent.SendStarted, clock()).item
        tasks[item.identity.key] = item
        parts.forEachIndexed { index, part ->
            val operationId = "${item.identity.key}:${item.discoveredAtMs}:${index + 1}"
            val sendResult = ui.sendText(part, operationId)
            if (!sendResult.sent || !sendResult.verified) {
                return blocked(
                    item,
                    sendResult.reason.ifBlank { "发送没有确认，禁止自动重发" },
                )
            }
            item = move(
                item,
                ConversationWorkEvent.SendPartConfirmed(index + 1),
                clock(),
            ).item
            tasks[item.identity.key] = item
        }

        item = move(item, ConversationWorkEvent.SendVerified, clock()).item
        tasks[item.identity.key] = item
        if (!ui.returnToMessageList()) {
            return blocked(item, "消息已发，但没能确认回到消息列表")
        }
        item = move(item, ConversationWorkEvent.ReturnedToList, clock()).item
        tasks[item.identity.key] = item
        return ConversationOrchestrationOutcome.Completed(
            identity = item.identity,
            item = item,
            replyParts = parts.size,
        )
    }

    private fun retry(
        item: ConversationWorkItem,
        reason: String,
    ): ConversationOrchestrationOutcome {
        val next = move(
            item,
            ConversationWorkEvent.RetryRequested(reason, RETRY_DELAY_MS),
            clock(),
        ).item
        tasks[next.identity.key] = next
        return ConversationOrchestrationOutcome.RetryLater(
            identity = next.identity,
            item = next,
            reason = reason,
        )
    }

    private fun blocked(
        item: ConversationWorkItem,
        reason: String,
    ): ConversationOrchestrationOutcome {
        val next = move(item, ConversationWorkEvent.Blocked(reason), clock()).item
        tasks[next.identity.key] = next
        return ConversationOrchestrationOutcome.Blocked(
            identity = next.identity,
            item = next,
            reason = reason,
        )
    }

    private fun move(
        item: ConversationWorkItem,
        event: ConversationWorkEvent,
        nowMs: Long,
    ): ConversationWorkTransition {
        return ConversationWorkStateMachine.apply(item, event, nowMs)
    }

    private companion object {
        const val RETRY_DELAY_MS = 1_500L
    }
}
