package com.aaiagent.engine

object ConversationReplyPolicy {
    fun shouldReply(lastSender: String?): Boolean {
        return !lastSender.isNullOrBlank() && lastSender != "self"
    }
}
