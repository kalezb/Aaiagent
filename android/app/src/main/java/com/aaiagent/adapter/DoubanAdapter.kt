package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult
import kotlinx.coroutines.delay

/**
 * 豆瓣适配器 (com.douban.frodo)
 *
 * 所有 View ID 均通过真机实测抓取（版本 7.135.1）：
 * - 私信列表：com.douban.frodo/.activity.MineNotificationActivity
 *   - 标签栏：id/custom_text（"提醒"、"私信"）
 *   - 列表项：id/conversation_title, id/conversation_message, id/time_stamp
 * - 聊天页面：com.douban.frodo/.chat.activity.ChatActivity
 *   - 对方名称：id/name (在 avatar_layout 内)
 *   - 输入框：id/input_text
 *   - 发送按钮：id/send_button
 *   - 收到消息：id/other_text
 *   - 发送消息：id/my_text
 *   - 平台限制：id/sys_text_title ("对方回复前只能发1条消息")
 *   - 发送图片：id/select_image
 */
class DoubanAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = PACKAGE_NAME

    companion object {
        const val PACKAGE_NAME = "com.douban.frodo"

        val OFFICIAL_ACCOUNTS = setOf(
            "豆瓣通知",
            "豆瓣市集",
            "豆瓣小组",
            "豆瓣活动",
            "官方通知",
            "系统通知"
        )

        fun isOfficialAccount(name: String): Boolean {
            return OFFICIAL_ACCOUNTS.any { name.contains(it) }
        }
    }

    // ── 页面识别 ──

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val hasInput = root.findAccessibilityNodeInfosByViewId("$packageName:id/input_text")
            .any { it.isEditable && it.isVisibleToUser }
        val hasChatTitle = root.findAccessibilityNodeInfosByViewId("$packageName:id/name").isNotEmpty()
        val hasToolbar = root.findAccessibilityNodeInfosByViewId("$packageName:id/toolbar").isNotEmpty()
        return hasInput && (hasChatTitle || hasToolbar)
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val hasTitles = root.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_title").isNotEmpty()
        val hasTabs = root.findAccessibilityNodeInfosByViewId("$packageName:id/custom_text")
            .any { it.text?.toString()?.contains("私信") == true }
        val hasListView = root.findAccessibilityNodeInfosByViewId("$packageName:id/list_view").isNotEmpty()
        return hasListView && (hasTitles || hasTabs)
    }

    override fun readChatTitle(root: AccessibilityNodeInfo): String? {
        val nameNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/name")
        val title = nameNodes.firstOrNull { it.isVisibleToUser }?.text?.toString()?.trim()
        if (!title.isNullOrBlank()) return title
        return nameNodes.firstOrNull()?.text?.toString()?.trim()?.takeIf { it.isNotBlank() }
    }

    override fun visibleUnreadCount(root: AccessibilityNodeInfo): Int {
        val countNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/unread_count")
        var sum = 0
        for (node in countNodes) {
            val count = node.text?.toString()?.toIntOrNull() ?: 1
            sum += count
        }
        val tabUnread = root.findAccessibilityNodeInfosByViewId("$packageName:id/unread_chat_count")
            .firstOrNull()?.text?.toString()?.toIntOrNull() ?: 0
        return maxOf(sum, tabUnread)
    }

    // ── 读消息 ──

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()

        // 递归按垂直屏幕位置收集消息，保证时间先后顺序正确
        collectMessagesInOrder(root, messages)

        return messages
    }

    private fun collectMessagesInOrder(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        val resId = node.viewIdResourceName.orEmpty()
        val text = node.text?.toString()?.trim().orEmpty()

        if (resId == "$packageName:id/my_text" && text.isNotBlank()) {
            messages.add(ChatMessage(sender = "self", content = text))
            return
        }
        if (resId == "$packageName:id/other_text" && text.isNotBlank()) {
            messages.add(ChatMessage(sender = "other", content = text))
            return
        }

        // 递归遍历子节点
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectMessagesInOrder(child, messages)
        }
    }

    // ── 发送消息 ──

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?
    ): SendResult {
        // 1. 严格防打扰规则：检查是否有未关注平台单条发信限制提示
        val sysPrompts = root.findAccessibilityNodeInfosByViewId("$packageName:id/sys_text_title")
        val hasRestriction = sysPrompts.any {
            val prompt = it.text?.toString().orEmpty()
            prompt.contains("只能发1条") || prompt.contains("关注对方可解除")
        }
        if (hasRestriction) {
            val currentMsgs = readMessages(root)
            if (currentMsgs.isNotEmpty() && currentMsgs.last().sender == "self") {
                // 我刚刚已经发过一条且对方未回复，严格遵循平台规则停止硬发
                return SendResult.NOT_VERIFIED
            }
        }

        // 2. 找到输入框并填入内容
        val inputNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/input_text")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val textSet = inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        if (!textSet) {
            return SendResult.TIMEOUT
        }

        // 3. 等待发送按钮出现（豆瓣输入文本后 select_image 会被 send_button 替换）
        delay(350)
        val freshRoot = service.rootInActiveWindow ?: root
        val sendNodes = freshRoot.findAccessibilityNodeInfosByViewId("$packageName:id/send_button")
        val sendButton = sendNodes.firstOrNull { it.isVisibleToUser && (it.isClickable || it.isEnabled) }
            ?: freshRoot.findAccessibilityNodeInfosByText("发送").firstOrNull { it.isVisibleToUser }
            ?: return SendResult.TIMEOUT

        sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)

        // 4. 发送后等待并检查是否有错误拦截
        delay(500)
        val postRoot = service.rootInActiveWindow ?: return SendResult.SUCCESS
        val errorKeywords = listOf("频率过高", "发送过于频繁", "被禁言", "已被限制", "违规", "发送失败")
        for (err in errorKeywords) {
            if (postRoot.findAccessibilityNodeInfosByText(err).any { it.isVisibleToUser }) {
                return SendResult.BANNED
            }
        }

        return SendResult.SUCCESS
    }

    // ── 发送照片 ──

    override suspend fun sendImage(
        service: AccessibilityService,
        expectedContactName: String?,
        imageBytes: ByteArray,
        fileName: String,
        contentType: String,
        canProceed: () -> Boolean
    ): SendResult {
        val root = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        val pickBtn = root.findAccessibilityNodeInfosByViewId("$packageName:id/select_image")
            .firstOrNull { it.isVisibleToUser && it.isClickable }
            ?: return SendResult.TIMEOUT

        if (!canProceed()) return SendResult.STOPPED
        pickBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        delay(800)

        // 等待相册/图片选择器加载
        val pickerRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        val firstPhoto = pickerRoot.findAccessibilityNodeInfosByViewId("$packageName:id/image")
            .firstOrNull { it.isVisibleToUser && it.isClickable }
            ?: pickerRoot.findAccessibilityNodeInfosByViewId("com.google.android.providers.media.module:id/icon_thumbnail")
                .firstOrNull { it.isVisibleToUser && it.isClickable }

        if (firstPhoto != null && canProceed()) {
            firstPhoto.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(400)
            val confirmBtn = (service.rootInActiveWindow ?: pickerRoot)
                .findAccessibilityNodeInfosByText("发送")
                .firstOrNull { it.isVisibleToUser && it.isClickable }
                ?: (service.rootInActiveWindow ?: pickerRoot)
                    .findAccessibilityNodeInfosByText("确定")
                    .firstOrNull { it.isVisibleToUser && it.isClickable }
            confirmBtn?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(600)
            return SendResult.SUCCESS
        }

        return SendResult.TIMEOUT
    }

    // ── 未读联系人查找与点击 ──

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean,
        contactFilter: suspend (contactName: String, contactId: String) -> Boolean
    ): ConversationInfo? {
        ensurePrivateMessageTabSelected(root)

        val listNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/list_view")
        val listView = listNodes.firstOrNull() ?: return null

        val titles = listView.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_title")
        for (titleNode in titles) {
            val contactName = titleNode.text?.toString()?.trim().orEmpty()
            if (contactName.isBlank() || isOfficialAccount(contactName)) continue
            if (!contactFilter(contactName, contactName)) continue

            // 查找对应的条目父节点或兄弟预览
            val rowParent = findConversationRowParent(titleNode)
            val preview = rowParent?.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_message")
                ?.firstOrNull()?.text?.toString()?.trim().orEmpty()

            // 检查是否有未读标记（红点 badge 或提示）
            val hasUnread = checkUnreadIndicator(rowParent)

            if (shouldClick && rowParent != null && rowParent.isClickable) {
                rowParent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } else if (shouldClick && titleNode.isClickable) {
                titleNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }

            return ConversationInfo(
                contactId = contactName,
                contactName = contactName,
                preview = preview,
                hasUnread = hasUnread
            )
        }
        return null
    }

    override suspend fun clickConversationByName(
        root: AccessibilityNodeInfo,
        contactName: String,
        shouldClick: Boolean,
        pageIndex: Int?,
        requireUnread: Boolean,
        expectedPreview: String
    ): ConversationInfo? {
        ensurePrivateMessageTabSelected(root)

        val listNodes = root.findAccessibilityNodeInfosByViewId("$packageName:id/list_view")
        val listView = listNodes.firstOrNull() ?: return null

        val titles = listView.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_title")
        val matchingRows = mutableListOf<Pair<AccessibilityNodeInfo, AccessibilityNodeInfo?>>()

        for (titleNode in titles) {
            val name = titleNode.text?.toString()?.trim().orEmpty()
            if (name == contactName) {
                val rowParent = findConversationRowParent(titleNode)
                matchingRows.add(titleNode to rowParent)
            }
        }

        if (matchingRows.isEmpty()) return null

        // 同名区分：如果有多个同名好友，通过 expectedPreview 寻找最匹配的那一行
        val chosen = if (matchingRows.size > 1 && expectedPreview.isNotBlank()) {
            matchingRows.firstOrNull { (_, row) ->
                val prev = row?.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_message")
                    ?.firstOrNull()?.text?.toString()?.trim().orEmpty()
                prev.contains(expectedPreview) || expectedPreview.contains(prev)
            } ?: matchingRows.first()
        } else {
            matchingRows.first()
        }

        val (chosenTitle, chosenRow) = chosen
        val preview = chosenRow?.findAccessibilityNodeInfosByViewId("$packageName:id/conversation_message")
            ?.firstOrNull()?.text?.toString()?.trim().orEmpty()

        if (shouldClick) {
            if (chosenRow != null && chosenRow.isClickable) {
                chosenRow.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } else {
                chosenTitle.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
        }

        return ConversationInfo(
            contactId = contactName,
            contactName = contactName,
            preview = preview,
            hasUnread = checkUnreadIndicator(chosenRow)
        )
    }

    private fun ensurePrivateMessageTabSelected(root: AccessibilityNodeInfo) {
        val tabs = root.findAccessibilityNodeInfosByViewId("$packageName:id/custom_text")
        val pmTab = tabs.firstOrNull { it.text?.toString()?.contains("私信") == true }
        if (pmTab != null && !pmTab.isSelected) {
            pmTab.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }
    }

    private fun findConversationRowParent(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node.parent
        for (i in 0 until 4) {
            if (current == null) break
            if (current.isClickable) return current
            current = current.parent
        }
        return node.parent
    }

    private fun checkUnreadIndicator(rowParent: AccessibilityNodeInfo?): Boolean {
        if (rowParent == null) return false
        val rect = Rect()
        // 查找带有小红点或未读标记特征的子视图
        for (i in 0 until rowParent.childCount) {
            val child = rowParent.getChild(i) ?: continue
            val id = child.viewIdResourceName.orEmpty().lowercase()
            if (id.contains("unread") || id.contains("badge") || id.contains("dot") || id.contains("count")) {
                return true
            }
            child.getBoundsInScreen(rect)
            if (rect.width() in 10..40 && rect.height() in 10..40 && child.className?.toString()?.contains("View") == true) {
                return true
            }
        }
        return false
    }

    private fun isOfficialAccount(name: String): Boolean {
        return OFFICIAL_ACCOUNTS.any { name.contains(it) }
    }

    // ── 导航与前台 ──

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo): Boolean {
        if (isInMessageList(root)) {
            ensurePrivateMessageTabSelected(root)
            return true
        }

        // 如果在单聊页，先点左上角返回
        if (isInChat(root)) {
            val backBtn = root.findAccessibilityNodeInfosByViewId("$packageName:id/toolbar")
                .firstOrNull()?.findAccessibilityNodeInfosByViewId("") // imageButton
                ?.firstOrNull { it.isClickable }
                ?: root.findAccessibilityNodeInfosByText("Navigate up").firstOrNull { it.isClickable }

            if (backBtn != null) {
                backBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } else {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            }
            delay(500)
            val current = service.rootInActiveWindow
            if (current != null && isInMessageList(current)) {
                ensurePrivateMessageTabSelected(current)
                return true
            }
        }

        // 如果在豆瓣首页，点击右上角消息通知铃铛（menu_notification / ic_notification）
        val notifBtn = root.findAccessibilityNodeInfosByViewId("$packageName:id/menu_notification").firstOrNull()
            ?: root.findAccessibilityNodeInfosByViewId("$packageName:id/ic_notification").firstOrNull()
        if (notifBtn != null) {
            val clicked = if (notifBtn.isClickable) {
                notifBtn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } else {
                notifBtn.parent?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            }
            if (clicked) {
                delay(800)
                val current = service.rootInActiveWindow
                if (current != null && isInMessageList(current)) {
                    ensurePrivateMessageTabSelected(current)
                    return true
                }
            }
        }

        // 尝试返回最多 2 次
        for (i in 1..2) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(400)
            val cur = service.rootInActiveWindow ?: break
            if (isInMessageList(cur)) {
                ensurePrivateMessageTabSelected(cur)
                return true
            }
        }

        return service.rootInActiveWindow?.let { isInMessageList(it) } == true
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        try {
            val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
            delay(1000)
        } catch (_: Exception) {}
    }
}
