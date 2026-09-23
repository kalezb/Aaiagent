package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.SendResult

class SoulAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "cn.soulapp.android"

    private val PREFIX = "cn.soulapp.android:id/"

    // Soul \u804A\u5929\u9875\u7279\u5F81\uFF1A\u6709\u8F93\u5165\u6846 et_sendmessage + \u6D88\u606F\u9879 item_root
    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val hasInput = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage").isNotEmpty()
        val hasMessages = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_root").isNotEmpty()
        // \u6392\u9664 AI \u5EFA\u8BAE\u5361\u7247\u5E72\u6270\uFF1A\u5982\u679C\u53EA\u6709 aigcRootView \u6CA1\u6709 item_root\uFF0C\u4E0D\u662F\u804A\u5929\u9875
        return hasInput && hasMessages
    }

    // Soul \u6D88\u606F\u5217\u8868\u7279\u5F81\uFF1A\u6709 conversation_list \u6216 item_content_root
    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        val hasConvList = root.findAccessibilityNodeInfosByViewId(PREFIX + "conversation_list").isNotEmpty()
        if (hasConvList) return true
        val items = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_content_root")
        return items.size >= 2
    }

    // \u8BFB\u53D6\u804A\u5929\u9875\u4E2D\u7684\u6D88\u606F\uFF0C\u53EA\u8FD4\u56DE\u5BF9\u65B9\u53D1\u7684\u6587\u5B57\u6D88\u606F
    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()

        // \u627E\u6240\u6709\u6D88\u606F\u9879 item_root
        val messageItems = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_root")
        for (item in messageItems) {
            // \u8DF3\u8FC7\u4E0D\u53EF\u89C1\u7684\u6D88\u606F
            if (!item.isVisibleToUser) continue

            // \u8FC7\u6EE4 AI \u5EFA\u8BAE\u5361\u7247
            val aigcNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "aigcRootView")
            if (aigcNodes.isNotEmpty()) continue

            // \u8FC7\u6EE4\u9690\u79C1\u4FDD\u62A4\u56FE / \u95EA\u56FE
            val privacyNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "tv_privacy_protect_tag")
            if (privacyNodes.isNotEmpty()) continue

            // \u5224\u65AD\u662F\u6211\u53D1\u7684\u8FD8\u662F\u5BF9\u65B9\u53D1\u7684\uFF1A\u770B\u5934\u50CF
            val hasMeAvatar = item.findAccessibilityNodeInfosByViewId(PREFIX + "meAvatar").isNotEmpty()
            val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(PREFIX + "otherAvatar").isNotEmpty()

            if (hasMeAvatar && !hasOtherAvatar) continue // \u81EA\u5DF1\u53D1\u7684\uFF0C\u8DF3\u8FC7

            // \u8BFB\u53D6\u6587\u5B57\u5185\u5BB9
            val textNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "content_text")
            val content = textNodes.mapNotNull { it.text?.toString()?.trim() }
                .filter { it.isNotEmpty() }
                .joinToString("")

            if (content.isNotEmpty()) {
                messages.add(ChatMessage(sender = "other", content = content))
            }
        }

        // Fallback: \u5982\u679C\u6CA1\u627E\u5230\u4EFB\u4F55\u6D88\u606F\uFF0C\u5C1D\u8BD5\u901A\u8FC7 TextView \u722C\u53D6
        if (messages.isEmpty()) {
            fallbackReadTextViews(root, messages)
        }

        return messages
    }

    // Fallback: \u9012\u5F52\u904D\u5386\u6240\u6709 TextView\uFF0C\u6309\u4F4D\u7F6E\u5224\u65AD\u53D1\u9001\u8005
    private fun fallbackReadTextViews(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = android.graphics.Rect()
                node.getBoundsInScreen(rect)
                // \u5C4F\u5E55\u5BBD\u5EA6\u5047\u8BBE 1080px\uFF0C\u53F3\u4FA7\u4E3A\u81EA\u5DF1\u53D1\u7684
                val isSelf = rect.left > 600
                if (!isSelf) {
                    messages.add(ChatMessage(sender = "other", content = text))
                }
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            fallbackReadTextViews(child, messages)
        }
    }

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult {
        // 1. \u627E\u8F93\u5165\u6846
        val inputNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: run {
                // \u5C1D\u8BD5\u91CD\u65B0\u83B7\u53D6 root
                val retry = service.rootInActiveWindow
                    ?.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
                    ?.firstOrNull { it.isEditable && it.isVisibleToUser }
                retry ?: return SendResult.TIMEOUT
            }

        // 2. \u8BBE\u7F6E\u6587\u672C
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

        // 3. \u7B49\u5F85\u53D1\u9001\u6309\u94AE\u53EF\u7528
        kotlinx.coroutines.delay(500)
        val retryRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        val sendNodes = retryRoot.findAccessibilityNodeInfosByViewId(PREFIX + "btn_send")
        val sendButton = sendNodes.firstOrNull { it.isClickable && it.isVisibleToUser }
        if (sendButton == null) {
            // Soul \u53EF\u80FD\u6CA1\u6709 btn_send\uFF0C\u5C1D\u8BD5\u6309\u786C\u4EF6\u56DE\u8F66\u952E
            inputField.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            kotlinx.coroutines.delay(200)
            // \u5C1D\u8BD5\u4F7F\u7528\u5168\u5C40\u56DE\u8F66\u952E
            // \u6CE8\u610F\uFF1A\u8FD9\u4E2A\u65B9\u6CD5\u5728\u67D0\u4E9B\u65E0\u969C\u788D\u670D\u52A1\u4E2D\u53EF\u80FD\u4E0D\u53EF\u7528
            return SendResult.TIMEOUT
        }
        sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)

        // 4. \u68C0\u6D4B\u7ED3\u679C
        kotlinx.coroutines.delay(800)
        val checkRoot = service.rootInActiveWindow ?: return SendResult.SUCCESS
        if (detectBanned(checkRoot)) return SendResult.BANNED

        return SendResult.SUCCESS
    }

    // 半自动模式：只填输入框不发送
    suspend fun fillInputOnly(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val inputNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return false
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun detectBanned(root: AccessibilityNodeInfo): Boolean {
        val errorKeywords = listOf("\u53D1\u9001\u5931\u8D25", "\u5DF2\u88AB\u7981\u8A00", "\u53D1\u8A00\u592A\u5FEB", "\u5185\u5BB9\u8FDD\u89C4")
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val text = node.text?.toString() ?: ""
            if (errorKeywords.any { text.contains(it) }) return true
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return false
    }

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean
    ): ConversationInfo? {
        // \u4F18\u5148\u7528 Soul \u7279\u5B9A View ID \u627E\u672A\u8BFB\u6570\u5B57
        val unreadBadges = root.findAccessibilityNodeInfosByViewId(PREFIX + "unread_msg_number")
            .filter { it.isVisibleToUser && it.text?.toString()?.toIntOrNull() != null }

        if (unreadBadges.isEmpty()) return null

        // \u627E\u5230\u7B2C\u4E00\u4E2A\u672A\u8BFB\u5BF9\u5E94\u7684\u4F1A\u8BDD\u9879 item_content_root
        val badge = unreadBadges.first()
        val conversationItem = findAncestorByViewId(badge, "item_content_root") ?: return null

        // \u8BFB\u53D6\u8054\u7CFB\u4EBA\u4FE1\u606F
        val name = readChildText(conversationItem, "name")
        val preview = readChildText(conversationItem, "message")
        val contactName = name ?: preview ?: "unknown"

        if (shouldClick && conversationItem.isClickable) {
            conversationItem.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        return ConversationInfo(
            contactId = contactName,
            contactName = contactName,
            preview = preview ?: ""
        )
    }

    // \u5411\u4E0A\u67E5\u627E\u5305\u542B\u6307\u5B9A View ID \u7684\u7956\u5148\u8282\u70B9
    private fun findAncestorByViewId(node: AccessibilityNodeInfo, targetId: String): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node.parent
        while (current != null) {
            val found = current.findAccessibilityNodeInfosByViewId(PREFIX + targetId)
            if (found.isNotEmpty()) return found.first()
            current = current.parent
        }
        return null
    }

    // \u8BFB\u53D6\u5B50\u8282\u70B9\u4E2D\u6307\u5B9A View ID \u7684\u6587\u672C
    private fun readChildText(parent: AccessibilityNodeInfo, viewId: String): String? {
        val nodes = parent.findAccessibilityNodeInfosByViewId(PREFIX + viewId)
        return nodes.firstOrNull()?.text?.toString()?.trim()
    }

    // Soul \u5BFC\u822A\u5230\u6D88\u606F\u5217\u8868\uFF1A\u6309\u8FD4\u56DE\u952E\u76F4\u5230\u627E\u5230 conversation_list
    // Soul 导航到消息列表
    // Soul 默认进入广场页，需要点底部“消息”栏目
    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) {
            android.util.Log.d("AIA", "Soul navigateToMessageList: already in message list")
            return
        }

        // 方法1：找底部导航栏中的“消息”或“聊天”标签
        android.util.Log.d("AIA", "Soul navigateToMessageList: searching for message tab...")
        val keywords = listOf("消息", "聊天", "message", "chat", "IM")
        
        // 递归搜索所有可点击的 TextView 或 ImageView
        val clickableNodes = mutableListOf<AccessibilityNodeInfo>()
        findClickableTextNodes(root, clickableNodes, keywords)
        
        android.util.Log.d("AIA", "Soul navigateToMessageList: found ${clickableNodes.size} candidate nodes")
        for (node in clickableNodes) {
            val text = node.text?.toString() ?: node.contentDescription?.toString() ?: ""
            android.util.Log.d("AIA", "Soul navigateToMessageList: trying '$text'")
            try {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                kotlinx.coroutines.delay(800)
                val newRoot = service.rootInActiveWindow
                if (newRoot != null && isInMessageList(newRoot)) {
                    android.util.Log.d("AIA", "Soul navigateToMessageList: success via '$text'")
                    return
                }
            } catch (_: Exception) {}
        }

        // 方法2：如果还找不到，先返回X次回到主页，再找
        android.util.Log.d("AIA", "Soul navigateToMessageList: fallback - pressing back then retrying")
        repeat(2) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            kotlinx.coroutines.delay(500)
        }
        val freshRoot = service.rootInActiveWindow ?: return
        // 重新搜索
        findClickableTextNodes(freshRoot, clickableNodes, keywords)
        for (node in clickableNodes) {
            try {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                kotlinx.coroutines.delay(800)
                val newRoot = service.rootInActiveWindow
                if (newRoot != null && isInMessageList(newRoot)) {
                    android.util.Log.d("AIA", "Soul navigateToMessageList: success via fallback")
                    return
                }
            } catch (_: Exception) {}
        }
        
        android.util.Log.w("AIA", "Soul navigateToMessageList: FAILED - could not find message list")
    }

    // 递归找包含关键词的可点击节点
    private fun findClickableTextNodes(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>, keywords: List<String>) {
        if (!node.isVisibleToUser) return
        
        val text = (node.text?.toString() ?: "") + (node.contentDescription?.toString() ?: "")
        if (node.isClickable && keywords.any { text.contains(it, ignoreCase = true) }) {
            results.add(node)
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findClickableTextNodes(it, results, keywords) }
        }
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        try {
            val intent = service.packageManager.getLaunchIntentForPackage(packageName)
            intent?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            service.startActivity(intent)
            kotlinx.coroutines.delay(1500)
        } catch (_: Exception) {}
    }
}
