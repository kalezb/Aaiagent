package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult
import kotlinx.coroutines.delay

/**
 * QQ 适配器 (补充页-QQ适配器开发指南)
 * 所有 View ID 均通过 USB 调试实测抓取, 真实有效
 */
class QQAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "com.tencent.mobileqq"

    // ── 页面识别 ──

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val hasInput = root.findAccessibilityNodeInfosByViewId("$packageName:id/input")
            .any { it.isEditable && it.isVisibleToUser }
        val hasSendBtn = root.findAccessibilityNodeInfosByViewId("$packageName:id/send_btn")
            .any { it.isVisibleToUser }
        return hasInput && hasSendBtn
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val nodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/o8n")
        return nodes.isNotEmpty()
    }

    // ── 读消息 ──

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        // QQ 所有消息文本都在 mj0 里
        val textNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/mj0")
        for (textNode in textNodes) {
            val content = textNode.text?.toString()?.trim() ?: ""
            if (content.isEmpty()) continue

            // 区分对方/自己: 查头像 content-desc
            val sender = findSenderByAvatar(textNode)
            messages.add(ChatMessage(sender = sender, content = content))
        }
        return messages
    }

    /**
     * 通过头像 content-desc 区分方向 (补充 §六)
     * - "xxx的资料卡" → 对方
     * - "我的资料卡" → 自己
     */
    private fun findSenderByAvatar(msgNode: AccessibilityNodeInfo): String {
        // 向上找消息容器 root → 找里面的头像 vd0
        var parent: AccessibilityNodeInfo? = msgNode.parent
        for (depth in 1..5) {
            if (parent == null) break
            val avatars = parent.findAccessibilityNodeInfosByViewId("$packageName:id/vd0")
            for (av in avatars) {
                val desc = av.contentDescription?.toString() ?: ""
                if (desc.contains("我的资料卡")) return "self"
                if (desc.contains("资料卡")) return desc.substringBefore("的资料卡")
            }
            parent = parent.parent
        }
        // 备选: 看位置
        val rect = android.graphics.Rect()
        msgNode.getBoundsInScreen(rect)
        return if (rect.left > 540) "self" else "other"
    }

    // ── 发送消息 ──

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?
    ): SendResult {
        // 1. 找输入框
        val inputNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/input")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        // 2. 填入文本
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        // 3. 等发送按钮变为可点击 (QQ 输入文字后才 enabled)
        delay(300)
        val sendNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/send_btn")
        val sendButton = sendNodes.firstOrNull { it.isClickable && it.isEnabled && it.isVisibleToUser }
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
        // 1. 找会话列表 RecyclerView (o8n)
        val listNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/o8n")
        val listView = listNodes.firstOrNull() ?: return null

        // 2. 遍历每个会话项 (o8c)
        val items = listView.findAccessibilityNodeInfosByViewId("$packageName:id/o8c")
        for (item in items) {
            if (!item.isVisibleToUser) continue

            // 3. 读昵称
            val titles = item.findAccessibilityNodeInfosByViewId("$packageName:id/title")
            val contactName = titles.firstOrNull()?.text?.toString()?.trim() ?: continue
            if (!contactFilter(contactName, contactName)) continue

            // 4. 查未读标记 (khc)
            val unreads = item.findAccessibilityNodeInfosByViewId("$packageName:id/khc")
            if (unreads.isEmpty()) continue  // 没有未读, 跳过

            // 5. 读预览
            val preview = readPreview(item)

            if (shouldClick && item.isClickable) {
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

    private fun readPreview(item: AccessibilityNodeInfo): String {
        // 遍历会话项里的所有 TextView, 取第二条 (第一条是昵称)
        val texts = mutableListOf<String>()
        fun collect(node: AccessibilityNodeInfo) {
            val t = node.text?.toString()?.trim() ?: ""
            if (t.isNotEmpty() && t.length > 1 && !t.contains(":")) texts.add(t)
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { collect(it) }
            }
        }
        collect(item)
        return texts.getOrNull(1) ?: ""
    }

    // ── 导航 ──

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

        // 聊天页 → 点返回按钮
        val backBtns = root.findAccessibilityNodeInfosByViewId("$packageName:id/ivTitleBtnLeft")
        val backBtn = backBtns.firstOrNull {
            it.contentDescription?.toString()?.contains("返回") == true && it.isClickable
        }
        if (backBtn != null) {
            backBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(500)
            return
        }

        // 其他页面 → 点底部 "消息" tab
        val tabs = root.findAccessibilityNodeInfosByViewId("$packageName:id/kbi")
        for (tab in tabs) {
            if (tab.text?.toString() == "消息" && tab.isClickable) {
                tab.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                delay(500)
                return
            }
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
