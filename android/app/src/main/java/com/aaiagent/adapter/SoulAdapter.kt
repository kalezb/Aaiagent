package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo

class SoulAdapter(service: AccessibilityService) : PlatformAdapter(service) {
    override val platformName = "soul"
    override val targetPackage = "com.soulapp.cn"

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val chatIndicators = listOf("soul_chat_input", "message_input")
        for (id in chatIndicators) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            if (nodes.isNotEmpty()) return true
        }
        val inputFields = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/editText")
        if (inputFields.isNotEmpty()) {
            for (node in inputFields) {
                if (node.isVisibleToUser && node.isFocused) return true
            }
        }
        return false
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val listIds = listOf("recycler_view", "message_list", "rv_conversation")
        for (id in listIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            if (nodes.isNotEmpty()) return true
        }
        // Fallback: find RecyclerView with conversation items
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            if (child.className?.toString()?.contains("RecyclerView") == true &&
                child.isVisibleToUser) {
                return true
            }
        }
        return false
    }

    override fun getUnreadMessages(root: AccessibilityNodeInfo): List<MessageInfo> {
        val messages = mutableListOf<MessageInfo>()
        val msgContainerIds = listOf("chat_message_list", "rv_chat")
        for (id in msgContainerIds) {
            val containers = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            for (container in containers) {
                extractMessages(container, messages)
            }
        }
        // Fallback: search all TextViews in chat
        if (messages.isEmpty()) {
            extractMessages(root, messages)
        }
        return messages
    }

    private fun extractMessages(node: AccessibilityNodeInfo, messages: MutableList<MessageInfo>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                messages.add(MessageInfo(
                    id = "soul_${text.hashCode()}_${System.currentTimeMillis()}",
                    content = text
                ))
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            extractMessages(child, messages)
        }
    }

    override fun getContactId(root: AccessibilityNodeInfo): String? {
        val titleIds = listOf("title", "chat_name", "tv_name")
        for (id in titleIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            for (node in nodes) {
                val text = node.text?.toString()?.trim()
                if (!text.isNullOrEmpty()) return text
            }
        }
        return null
    }

    override fun getContactName(root: AccessibilityNodeInfo): String? = getContactId(root)

    override fun getInputField(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("editText", "message_input", "et_content")
        for (id in ids) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            for (node in nodes) {
                if (node.isEditable && node.isVisibleToUser) return node
            }
        }
        // Fallback: search any editable node
        return findEditableNode(root)
    }

    override fun getSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val ids = listOf("send", "btn_send", "iv_send")
        for (id in ids) {
            val nodes = root.findAccessibilityNodeInfosByViewId("$targetPackage:id/$id")
            for (node in nodes) {
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
            val child = node.getChild(i) ?: continue
            val result = findEditableNode(child)
            if (result != null) return result
        }
        return null
    }

    private fun findClickableWithText(node: AccessibilityNodeInfo, texts: List<String>): AccessibilityNodeInfo? {
        val nodeText = node.text?.toString()?.trim() ?: ""
        if (texts.any { nodeText.contains(it, ignoreCase = true) } && node.isClickable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findClickableWithText(child, texts)
            if (result != null) return result
        }
        return null
    }
}