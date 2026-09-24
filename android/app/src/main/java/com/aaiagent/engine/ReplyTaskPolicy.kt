package com.aaiagent.engine

enum class ReplyTaskAction {
    SEND_EXACT,
    PROCESS_AI,
    IGNORE
}

object ReplyTaskPolicy {
    fun decide(taskType: String?, platform: String?, currentPlatform: String): ReplyTaskAction {
        if (platform != currentPlatform) return ReplyTaskAction.IGNORE
        return when (taskType) {
            "manual" -> ReplyTaskAction.SEND_EXACT
            "priority_contact" -> ReplyTaskAction.PROCESS_AI
            else -> ReplyTaskAction.IGNORE
        }
    }
}
