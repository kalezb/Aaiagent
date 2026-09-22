package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo

class ImmomoAdapter(service: AccessibilityService) : PlatformAdapter(service) {
    override val platformName = "immomo"
    override val targetPackage = "com.immomo.momo"

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        return findEditableNode(root) != null && !isInMessageList(root)
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        return findRecyclerViewWithItems(root, 5)
    }

    override fun getUnreadMessages(root: AccessibilityNodeInfo): List<MessageInfo> {
        val messages = mutableListOf<MessageInfo>()
        for (i in 0 until root.childCount) {
            root.getChild(i)?.let { extractMessages(it, messages) }
        }
        return messages.takeLast(20)
    }

    private fun extractMessages(node: AccessibilityNodeInfo, messages: MutableList<MessageInfo>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1 && text.length < 500) {
                messages.add(MessageInfo(
                    id = "momo_${text.hashCode()}_${System.currentTimeMillis()}",
                    content = text
                ))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { extractMessages(it, messages) }
        }
    }

    override fun getContactId(root: AccessibilityNodeInfo): String? {
        return findTitleText(root)
    }

    override fun getContactName(root: AccessibilityNodeInfo): String? = getContactId(root)

    override fun getInputField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        return findEditableNode(root)
    }

    override fun getSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
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

    private fun findRecyclerViewWithItems(node: AccessibilityNodeInfo, minChildren: Int): Boolean {
        if (node.className?.toString()?.contains("RecyclerView") == true &&
            node.childCount >= minChildren &&
            node.isVisibleToUser) return true
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { if (findRecyclerViewWithItems(it, minChildren)) return true }
        }
        return false
    }

    private fun findTitleText(node: AccessibilityNodeInfo): String? {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.length in 2..20 && !text.contains(" ")) return text
        }
        for (i in 0 until minOf(node.childCount, 5)) {
            node.getChild(i)?.let { findTitleText(it) }?.let { return it }
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