package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

class QQAdapter(service: AccessibilityService) : PlatformAdapter(service) {
    override val platformName = "qq"
    override val targetPackage = "com.tencent.mobileqq"

    private fun findNodeById(root: AccessibilityNodeInfo, id: String): List<AccessibilityNodeInfo> {
        return root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
    }

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val ids = listOf("input", "editText", "inputBar")
        for (id in ids) {
            if (findNodeById(root, id).any { it.isVisibleToUser }) return true
        }
        return false
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val ids = listOf("recent_chat_list", "conversation_list", "listview")
        for (id in ids) {
            if (findNodeById(root, id).isNotEmpty()) return true
        }
        return findRecyclerView(root) != null
    }

    override fun getUnreadMessages(root: AccessibilityNodeInfo): List<MessageInfo> {
        val messages = mutableListOf<MessageInfo>()
        val ids = listOf("chat_item_content_layout", "msg_item", "bubble")
        for (id in ids) {
            for (container in findNodeById(root, id)) {
                extractTextNodes(container, messages)
            }
        }
        if (messages.isEmpty()) extractTextNodes(root, messages)
        return messages
    }

    private fun extractTextNodes(node: AccessibilityNodeInfo, messages: MutableList<MessageInfo>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                messages.add(MessageInfo(
                    id = "qq_${text.hashCode()}_${System.currentTimeMillis()}",
                    content = text
                ))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { extractTextNodes(it, messages) }
        }
    }

    override fun getContactId(root: AccessibilityNodeInfo): String? {
        val ids = listOf("title", "chat_title", "name")
        for (id in ids) {
            for (node in findNodeById(root, id)) {
                val text = node.text?.toString()?.trim()
                if (!text.isNullOrEmpty()) return text
            }
        }
        return null
    }

    override fun getContactName(root: AccessibilityNodeInfo): String? = getContactId(root)

    override fun getInputField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("input", "editText")
        for (id in ids) {
            for (node in findNodeById(root, id)) {
                if (node.isEditable && node.isVisibleToUser) return node
            }
        }
        return findEditableNode(root)
    }

    override fun getSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("send_btn", "sendBtn", "btn_send", "fun_btn")
        for (id in ids) {
            for (node in findNodeById(root, id)) {
                if (node.isClickable && node.isVisibleToUser) return node
            }
        }
        return findClickableWithText(root, listOf("发送", "send"))
    }

    override fun openChat(targetContact: String?, root: AccessibilityNodeInfo): Boolean {
        if (targetContact != null) {
            val items = findClickableWithText(root, listOf(targetContact))
            if (items != null) {
                items.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return true
            }
        }
        return false
    }

    private fun findEditableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable && node.isVisibleToUser) return node
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findEditableNode(it) }?.let { return it }
        }
        return null
    }

    private fun findRecyclerView(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.className?.toString()?.contains("RecyclerView") == true && node.isVisibleToUser) return node
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findRecyclerView(it) }?.let { return it }
        }
        return null
    }

    private fun findClickableWithText(node: AccessibilityNodeInfo, texts: List<String>): AccessibilityNodeInfo? {
        val nodeText = node.text?.toString()?.trim() ?: ""
        if (texts.any { nodeText.contains(it, ignoreCase = true) } && node.isClickable) return node
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findClickableWithText(it, texts) }?.let { return it }
        }
        return null
    }
}