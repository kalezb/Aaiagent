package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * Confirms that the bubble returned by the platform is also visible in the
 * current chat. The platform send callback can succeed before accessibility
 * has exposed the new row, so callers should retry briefly before logging a
 * verification miss.
 */
object ReplyDeliveryVerificationPolicy {
    /**
     * 聊天页不再自动滚到底后，刚发出的气泡可能仍在屏幕下方看不到。
     * 输入框已经清空且发送按钮恢复为未输入状态时，同样按已发送成功处理。
     */
    fun isSendConfirmed(
        outgoingVisible: Boolean,
        inputCleared: Boolean,
    ): Boolean = outgoingVisible || inputCleared

    fun isOutgoingVisible(
        messages: List<ChatMessage>,
        expectedContent: String
    ): Boolean {
        val expected = normalize(expectedContent)
        if (expected.isEmpty()) return false
        return messages
            .asReversed()
            .asSequence()
            .filter { it.sender == "self" }
            .map { normalize(it.content) }
            .any { it == expected }
    }

    private fun normalize(value: String): String {
        return value.trim().replace(Regex("\\s+"), " ")
    }
}
