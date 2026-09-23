package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult

class SoulAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "cn.soulapp.android"

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        var hits = 0
        val indicators = listOf("chat_avatar", "chat_follow_btn", "et_sendmessage")
        for (id in indicators) {
            val nodes = root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/" + id)
            if (nodes.isNotEmpty()) hits++
        }
        return hits >= 2
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val nodes = root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/conversation_list")
        if (nodes.isNotEmpty()) return true
        // fallback: check for conversation items
        val items = root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/item_content_root")
        return items.isNotEmpty()
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        // 用方向爬取遍历消息节点
        crawlMessages(root, messages)
        return messages
    }

    private fun crawlMessages(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        // 检查消息容器
        val containers = node.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/item_content_root")
        for (container in containers) {
            extractMessage(container, messages)
        }

        // Fallback: 递归检查 TextView
        if (messages.isEmpty()) {
            extractTextMessages(node, messages)
        }
    }

    private fun extractMessage(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        val texts = mutableListOf<String>()
        collectTexts(node, texts)
        val content = texts.joinToString("").trim()
        if (content.isNotEmpty() && content.length > 1) {
            // 左右侧判断：检查节点在屏幕中的位置
            val rect = android.graphics.Rect()
            node.getBoundsInScreen(rect)
            val sender = if (rect.left > 540) "self" else "other"
            messages.add(ChatMessage(sender = sender, content = content))
        }
    }

    private fun collectTexts(node: AccessibilityNodeInfo, texts: MutableList<String>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty()) texts.add(text)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectTexts(child, texts)
        }
    }

    private fun extractTextMessages(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = android.graphics.Rect()
                node.getBoundsInScreen(rect)
                val sender = if (rect.left > 540) "self" else "other"
                messages.add(ChatMessage(sender = sender, content = text))
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            extractTextMessages(child, messages)
        }
    }

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult {
        // 找输入框
        val inputNodes = root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        // 填入文本
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        // 等发送按钮出现
        kotlinx.coroutines.delay(300)
        val sendNodes = root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/btn_send")
        val sendButton = sendNodes.firstOrNull { it.isClickable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)

        // 检测是否发送失败或被禁言
        kotlinx.coroutines.delay(500)
        val root2 = service.rootInActiveWindow ?: return SendResult.SUCCESS
        val errorTexts = listOf("发送失败", "已被禁言", "发言太快")
        for (err in errorTexts) {
            for (i in 0 until root2.childCount) {
                val child = root2.getChild(i)
                if (child?.text?.toString()?.contains(err) == true) {
                    return SendResult.BANNED
                }
            }
        }

        return SendResult.SUCCESS
    }

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean
    ): ConversationInfo? {
        // 递归遍历找未读标记
        val unreadNodes = mutableListOf<AccessibilityNodeInfo>()
        findUnreadBadges(root, unreadNodes)

        if (unreadNodes.isEmpty()) return null

        // 取第一个未读，读昵称和预览
        val parent = findConversationParent(unreadNodes.first()) ?: return null
        val name = extractConversationName(parent)
        val preview = extractConversationPreview(parent)
        val contactId = name ?: "unknown"

        if (shouldClick && parent.isClickable) {
            parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        return ConversationInfo(
            contactId = contactId,
            contactName = name ?: contactId,
            preview = preview ?: ""
        )
    }

    private fun findUnreadBadges(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>) {
        val text = node.text?.toString()?.trim() ?: ""
        // 纯数字未读标记
        if (text.isNotEmpty() && text.all { it.isDigit() } && node.isVisibleToUser) {
            results.add(node)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findUnreadBadges(child, results)
        }
    }

    private fun findConversationParent(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node.parent
        while (current != null) {
            if (current.isClickable) return current
            current = current.parent
        }
        return null
    }

    private fun extractConversationName(node: AccessibilityNodeInfo): String? {
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val text = child.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && text.length in 1..20) return text
        }
        return null
    }

    private fun extractConversationPreview(node: AccessibilityNodeInfo): String? {
        val texts = mutableListOf<String>()
        fun collect(node: AccessibilityNodeInfo) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 2) texts.add(text)
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                collect(child)
            }
        }
        collect(node)
        return texts.getOrNull(1) // 第一条文本通常是昵称，第二条是预览
    }

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        // Soul 的消息列表通常是主页面，按返回键回到这里
        // 如果不在了，尝试全局返回
        if (!isInMessageList(root)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            kotlinx.coroutines.delay(500)
        }
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        // 通过无障碍服务确保 Soul 在前台
        try {
            val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
            kotlinx.coroutines.delay(1000)
        } catch (_: Exception) {}
    }
}
