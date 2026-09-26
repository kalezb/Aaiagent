package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult
import kotlinx.coroutines.delay

/**
 * 陌陌适配器 (补充页-陌陌适配器开发指南)
 * 所有 View ID 均通过 USB 调试实测抓取, 真实有效
 */
class ImmomoAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "com.immomo.momo"

    // ── 页面识别 ──

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val hasRecycler = root.findAccessibilityNodeInfosByViewId(
            "$packageName:id/message_chat_recycler_view"
        ).isNotEmpty()
        val hasInput = root.findAccessibilityNodeInfosByViewId(
            "$packageName:id/message_ed_msgeditor"
        ).any { it.isEditable && it.isVisibleToUser }
        return hasRecycler && hasInput
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val hasRecycler = root.findAccessibilityNodeInfosByViewId("$packageName:id/recyclerview").isNotEmpty()
        val hasName = root.findAccessibilityNodeInfosByViewId("$packageName:id/chatlist_item_tv_name").isNotEmpty()
        return hasRecycler && hasName
    }

    // ── 读消息 ──

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        // 陌陌消息文本都在 message_tv_layouttextview 里
        val textNodes = root.findAccessibilityNodeInfosByViewId(
            "$packageName:id/message_tv_layouttextview"
        )
        for (textNode in textNodes) {
            val content = textNode.text?.toString()?.trim() ?: ""
            if (content.isEmpty()) continue

            // 区分对方/自己: 查有没有 rightcontainer
            val sender = findSender(textNode)
            messages.add(ChatMessage(sender = sender, content = content))
        }

        // Fallback: message_tv_layouttextview 找不到 → 遍历 RecyclerView 读 TextView
        if (messages.isEmpty()) {
            val recycler = root.findAccessibilityNodeInfosByViewId(
                "$packageName:id/message_chat_recycler_view"
            ).firstOrNull()
            if (recycler != null) {
                extractFallbackMessages(recycler, messages)
            }
        }

        return messages
    }

    /**
     * 通过 rightcontainer 区分方向 (补充 §六)
     * - 有 message_layout_rightcontainer → 我发的
     * - 没有 → 对方发的
     */
    private fun findSender(msgNode: AccessibilityNodeInfo): String {
        var parent: AccessibilityNodeInfo? = msgNode.parent
        for (depth in 1..6) {
            if (parent == null) break
            val rights = parent.findAccessibilityNodeInfosByViewId(
                "$packageName:id/message_layout_rightcontainer"
            )
            if (rights.isNotEmpty()) return "self"
            parent = parent.parent
        }
        return "other"
    }

    private fun extractFallbackMessages(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = android.graphics.Rect()
                node.getBoundsInScreen(rect)
                messages.add(ChatMessage(
                    sender = if (rect.left > 540) "self" else "other",
                    content = text
                ))
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { extractFallbackMessages(it, messages) }
        }
    }

    // ── 发送消息 ──

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?
    ): SendResult {
        // 1. 找输入框
        val inputNodes = root.findAccessibilityNodeInfosByViewId(
            "$packageName:id/message_ed_msgeditor"
        )
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        // 2. 填入文本
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        // 3. 等发送按钮出现 (陌陌输入文字后才显示 right_btn_root)
        delay(400)
        val sendNodes = root.findAccessibilityNodeInfosByViewId(
            "$packageName:id/right_btn_root"
        )
        val sendButton = sendNodes.firstOrNull { it.isClickable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)

        // 4. 检测结果
        delay(500)
        val root2 = service.rootInActiveWindow ?: return SendResult.SUCCESS
        val errorTexts = listOf("内容违规", "敏感", "发送失败", "已被禁言", "账号被封")
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

    // ── 点未读会话 ──

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean,
        contactFilter: suspend (contactName: String, contactId: String) -> Boolean
    ): ConversationInfo? {
        // 1. 找会话列表 RecyclerView
        val listNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/recyclerview")
        val listView = listNodes.firstOrNull() ?: return null

        // 2. 遍历每个会话项 (item_layout)
        val items = listView.findAccessibilityNodeInfosByViewId("$packageName:id/item_layout")
        for (item in items) {
            if (!item.isVisibleToUser) continue

            // 3. 读昵称
            val names = item.findAccessibilityNodeInfosByViewId("$packageName:id/chatlist_item_tv_name")
            val contactName = names.firstOrNull()?.text?.toString()?.trim() ?: continue
            if (!contactFilter(contactName, contactName)) continue

            // 4. 查未读标记 (tv_status_new)
            val unreads = item.findAccessibilityNodeInfosByViewId(
                "$packageName:id/chatlist_item_tv_status_new"
            )
            if (unreads.isEmpty()) continue  // 没有未读

            // 5. 读预览
            val previews = item.findAccessibilityNodeInfosByViewId(
                "$packageName:id/chatlist_item_tv_content"
            )
            val preview = previews.firstOrNull()?.text?.toString()?.trim() ?: ""

            if (shouldClick && item.isClickable) {
                // 先关可能的引导弹窗 (陌陌有"语音唠嗑"引导)
                dismissGuidePopup(root)
                item.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }

            return ConversationInfo(
                contactId = contactName,
                contactName = contactName,
                preview = preview
            )
        }
        return null
    }

    /** 关掉陌陌引导弹窗 ("去聊天"按钮) */
    private fun dismissGuidePopup(root: AccessibilityNodeInfo) {
        val allClickable = mutableListOf<AccessibilityNodeInfo>()
        fun findClickable(node: AccessibilityNodeInfo) {
            if (node.isClickable && node.text?.toString()?.contains("去聊天") == true) {
                allClickable.add(node)
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { findClickable(it) }
            }
        }
        findClickable(root)
        for (btn in allClickable) {
            btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
    }

    // ── 导航 ──

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

        // 聊天页 → 系统返回
        if (isInChat(root)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(500)
            return
        }

        // 其他页面 → 点底部 "消息" tab
        val tab = root.findAccessibilityNodeInfosByViewId("$packageName:id/maintab_layout_chat")
            .firstOrNull { it.isClickable }
        if (tab != null) {
            tab.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(500)
            return
        }

        // 不认识 → 返回键, 最多 3 次
        for (i in 1..3) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(400)
            if (isInMessageList(service.rootInActiveWindow ?: break)) break
        }
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        try {
            val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
            delay(1000)
        } catch (_: Exception) {}
    }
}
