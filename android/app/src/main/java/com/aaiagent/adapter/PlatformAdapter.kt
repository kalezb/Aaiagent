package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

abstract class PlatformAdapter(
    protected val service: AccessibilityService
) {
    abstract val platformName: String
    abstract val targetPackage: String

    abstract fun isInChat(root: AccessibilityNodeInfo): Boolean
    abstract fun isInMessageList(root: AccessibilityNodeInfo): Boolean

    abstract fun getUnreadMessages(root: AccessibilityNodeInfo): List<MessageInfo>

    abstract fun getContactId(root: AccessibilityNodeInfo): String?
    abstract fun getContactName(root: AccessibilityNodeInfo): String?

    abstract fun getInputField(root: AccessibilityNodeInfo): AccessibilityNodeInfo?
    abstract fun getSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo?

    abstract fun openChat(targetContact: String?, root: AccessibilityNodeInfo): Boolean

    data class MessageInfo(
        val id: String,
        val content: String,
        val sender: String,
        val timestamp: Long = System.currentTimeMillis()
    )
}