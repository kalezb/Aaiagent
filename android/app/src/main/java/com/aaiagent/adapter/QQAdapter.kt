package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult

class QQAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "com.tencent.mobileqq"

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val nodes = root.findAccessibilityNodeInfosByViewId("/input")
        return nodes.any { it.isVisibleToUser }
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val nodes = root.findAccessibilityNodeInfosByViewId("/recent_chat_list")
        return nodes.isNotEmpty()
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        val containers = root.findAccessibilityNodeInfosByViewId("/chat_item_content_layout")
        for (container in containers) {
            val text = collectText(container)
            if (text.isNotEmpty()) {
                val rect = android.graphics.Rect()
                container.getBoundsInScreen(rect)
                messages.add(ChatMessage(sender = if (rect.left > 540) "self" else "other", content = text))
            }
        }
        return messages
    }

    private fun collectText(node: AccessibilityNodeInfo): String {
        val texts = mutableListOf<String>()
        fun collect(n: AccessibilityNodeInfo) {
            val t = n.text?.toString()?.trim() ?: ""
            if (t.isNotEmpty()) texts.add(t)
            for (i in 0 until n.childCount) {
                n.getChild(i)?.let { collect(it) }
            }
        }
        collect(node)
        return texts.joinToString("")
    }

    override suspend fun fillAndSend(service: AccessibilityService, root: AccessibilityNodeInfo, text: String): SendResult {
        val inputNodes = root.findAccessibilityNodeInfosByViewId("/input")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser } ?: return SendResult.TIMEOUT
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        kotlinx.coroutines.delay(300)
        val sendNodes = root.findAccessibilityNodeInfosByViewId("/fun_btn")
        val sendButton = sendNodes.firstOrNull { it.isClickable && it.isVisibleToUser } ?: return SendResult.TIMEOUT
        sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        return SendResult.SUCCESS
    }

    override suspend fun clickFirstUnreadConversation(root: AccessibilityNodeInfo, shouldClick: Boolean): ConversationInfo? = null
    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (!isInMessageList(root)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            kotlinx.coroutines.delay(500)
        }
    }
    override suspend fun bringToForeground(service: AccessibilityService) {
        try {
            val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
            kotlinx.coroutines.delay(1000)
        } catch (_: Exception) {}
    }
}
