package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

interface PlatformAdapter {
    val packageName: String

    fun isInChat(root: AccessibilityNodeInfo): Boolean
    fun isInMessageList(root: AccessibilityNodeInfo): Boolean
    fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage>
    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult
    suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean = true
    ): ConversationInfo?
    suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo)
    suspend fun bringToForeground(service: AccessibilityService)

    data class ChatMessage(
        val sender: String,
        val content: String
    )

    data class ConversationInfo(
        val contactId: String,
        val contactName: String,
        val preview: String
    )

    data class MessageInfo(
        val id: String,
        val content: String,
        val sender: String = "",
        val timestamp: Long = System.currentTimeMillis()
    )

    enum class SendResult {
        SUCCESS, BANNED, TIMEOUT
    }
}
