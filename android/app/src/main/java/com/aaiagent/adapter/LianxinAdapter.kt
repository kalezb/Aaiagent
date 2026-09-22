package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

class LianxinAdapter(service: AccessibilityService) : PlatformAdapter(service) {
    override val platformName = "lianxin"
    override val targetPackage = "com.lianxin.app"
    private val altPackage = "com.lianxin.lxchat"

    private fun findNodeByIds(root: AccessibilityNodeInfo, ids: List<String>): List<AccessibilityNodeInfo> {
        val results = mutableListOf<AccessibilityNodeInfo>()
        for (pkg in listOf(targetPackage, altPackage)) {
            for (id in ids) {
                results.addAll(root.findAccessibilityNodeInfosByViewId("$pkg:id/$id"))
            }
        }
        return results
    }

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val ids = listOf("edit_content", "input_edit", "et_sendmessage")
        for (node in findNodeByIds(root, ids)) {
            if (node.isEditable && node.isVisibleToUser) return true
        }
        return false
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val ids = listOf("lv_conversation", "message_list", "conversation_list")
        return findNodeByIds(root, ids).isNotEmpty() || findRecyclerView(root) != null
    }

    override fun getUnreadMessages(root: AccessibilityNodeInfo): List<MessageInfo> {
        val messages = mutableListOf<MessageInfo>()
        val ids = listOf("chat_message_item", "msg_content", "message_item")
        for (container in findNodeByIds(root, ids)) {
            extractMessages(container, messages)
        }
        if (messages.isEmpty()) extractMessages(root, messages)
        return messages
    }

    private fun extractMessages(node: AccessibilityNodeInfo, messages: MutableList<MessageInfo>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                messages.add(MessageInfo(
                    id = "lx_${text.hashCode()}_${System.currentTimeMillis()}",
                    content = text
                ))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { extractMessages(it, messages) }
        }
    }

    override fun getContactId(root: AccessibilityNodeInfo): String? {
        val ids = listOf("title", "chat_title", "tv_name", "contact_name")
        for (node in findNodeByIds(root, ids)) {
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty()) return text
        }
        return null
    }

    override fun getContactName(root: AccessibilityNodeInfo): String? = getContactId(root)

    override fun getInputField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("edit_content", "input_edit", "et_sendmessage")
        for (node in findNodeByIds(root, ids)) {
            if (node.isEditable && node.isVisibleToUser) return node
        }
        return findEditableNode(root)
    }

    override fun getSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("btn_send", "send_button", "iv_send")
        for (node in findNodeByIds(root, ids)) {
            if (node.isClickable && node.isVisibleToUser) return node
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