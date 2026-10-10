package com.aaiagent.engine.work

object ConversationWorkStateMachine {
    fun apply(
        item: ConversationWorkItem,
        event: ConversationWorkEvent,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.isComplete) {
            return reject(item, "任务已经完成，不能再改状态")
        }
        if (item.isBlocked && event !is ConversationWorkEvent.RetryRequested) {
            return reject(item, "任务已经被阻止")
        }
        return when (event) {
            ConversationWorkEvent.OpenRequested -> openRequested(item, nowMs)
            ConversationWorkEvent.ChatVerified -> chatVerified(item, nowMs)
            ConversationWorkEvent.ReadCompleted -> readCompleted(item, nowMs)
            ConversationWorkEvent.ReplyReady -> replyReady(item, nowMs)
            is ConversationWorkEvent.ReplyNotNeeded -> replyNotNeeded(item, event, nowMs)
            ConversationWorkEvent.SendStarted -> sendStarted(item, nowMs)
            is ConversationWorkEvent.SendPartConfirmed -> sendPartConfirmed(item, event, nowMs)
            ConversationWorkEvent.SendVerified -> sendVerified(item, nowMs)
            ConversationWorkEvent.ReturnedToList -> returnedToList(item, nowMs)
            is ConversationWorkEvent.RetryRequested -> retry(item, event, nowMs)
            is ConversationWorkEvent.Blocked -> blocked(item, event, nowMs)
        }
    }

    private fun openRequested(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.DISCOVERED &&
            item.state != ConversationWorkState.RETRY_LATER
        ) {
            return reject(item, "当前状态不能重新打开会话")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.OPENING,
                updatedAtMs = nowMs,
                nextAttemptAtMs = 0L,
                lastReason = "",
            ),
            "开始打开会话",
        )
    }

    private fun chatVerified(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.OPENING) {
            return reject(item, "没有正在打开的会话")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.READING,
                updatedAtMs = nowMs,
                lastReason = "",
            ),
            "联系人已经确认",
        )
    }

    private fun readCompleted(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.READING) {
            return reject(item, "当前不在读取消息阶段")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.WAITING_REPLY,
                updatedAtMs = nowMs,
            ),
            "消息读取完成",
        )
    }

    private fun replyReady(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.WAITING_REPLY) {
            return reject(item, "回复还没到可发送阶段")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.READY_TO_SEND,
                updatedAtMs = nowMs,
            ),
            "回复已经生成",
        )
    }

    private fun replyNotNeeded(
        item: ConversationWorkItem,
        event: ConversationWorkEvent.ReplyNotNeeded,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.WAITING_REPLY) {
            return reject(item, "当前没有待判断的回复")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.COMPLETE,
                updatedAtMs = nowMs,
                lastReason = event.reason.take(240),
            ),
            "确认不需要回复",
        )
    }

    private fun sendStarted(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.READY_TO_SEND) {
            return reject(item, "当前没有待发送回复")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.SENDING,
                updatedAtMs = nowMs,
            ),
            "开始发送",
        )
    }

    private fun sendPartConfirmed(
        item: ConversationWorkItem,
        event: ConversationWorkEvent.SendPartConfirmed,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.SENDING) {
            return reject(item, "当前不在发送阶段")
        }
        val sentParts = event.sentParts.coerceAtLeast(item.sentParts)
        if (sentParts == item.sentParts) {
            return reject(item, "重复的发送进度，忽略")
        }
        return accept(
            item.copy(
                sentParts = sentParts,
                updatedAtMs = nowMs,
            ),
            "发送进度已记录",
        )
    }

    private fun sendVerified(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.SENDING) {
            return reject(item, "没有待确认的发送")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.RETURNING,
                updatedAtMs = nowMs,
            ),
            "自己的气泡已确认",
        )
    }

    private fun returnedToList(
        item: ConversationWorkItem,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.state != ConversationWorkState.RETURNING) {
            return reject(item, "当前不需要返回消息列表")
        }
        return accept(
            item.copy(
                state = ConversationWorkState.COMPLETE,
                updatedAtMs = nowMs,
            ),
            "任务完成",
        )
    }

    private fun retry(
        item: ConversationWorkItem,
        event: ConversationWorkEvent.RetryRequested,
        nowMs: Long,
    ): ConversationWorkTransition {
        if (item.isComplete) return reject(item, "任务已经完成")
        return accept(
            item.copy(
                state = ConversationWorkState.RETRY_LATER,
                attempts = item.attempts + 1,
                nextAttemptAtMs = nowMs + event.delayMs.coerceAtLeast(0L),
                updatedAtMs = nowMs,
                lastReason = event.reason.take(240),
            ),
            "已安排重试",
        )
    }

    private fun blocked(
        item: ConversationWorkItem,
        event: ConversationWorkEvent.Blocked,
        nowMs: Long,
    ): ConversationWorkTransition {
        return accept(
            item.copy(
                state = ConversationWorkState.BLOCKED,
                updatedAtMs = nowMs,
                lastReason = event.reason.take(240),
            ),
            "任务已阻止",
        )
    }

    private fun accept(
        item: ConversationWorkItem,
        reason: String,
    ) = ConversationWorkTransition(item = item, accepted = true, reason = reason)

    private fun reject(
        item: ConversationWorkItem,
        reason: String,
    ) = ConversationWorkTransition(item = item, accepted = false, reason = reason)
}
