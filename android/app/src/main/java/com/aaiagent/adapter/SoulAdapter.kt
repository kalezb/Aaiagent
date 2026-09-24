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
        // 1. 点击输入框激活（Soul的输入框是View不是EditText，点击后才显示真正的EditText）
        val inputNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isClickable && it.isVisibleToUser }
        if (inputField == null) {
            android.util.Log.w("AIA", "Soul fillAndSend: et_sendmessage not found")
            return SendResult.TIMEOUT
        }
        
        // 先点击输入框激活
        inputField.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        kotlinx.coroutines.delay(300)
        
        // 重新获取root，找真正的EditText
        val retryRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        val allEditTexts = retryRoot.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        // 在所有子节点中找可编辑的
        var realInput: AccessibilityNodeInfo? = null
        for (node in allEditTexts) {
            if (node.isEditable && node.isVisibleToUser) {
                realInput = node
                break
            }
            // 也递归查找子节点
            for (i in 0 until node.childCount) {
                val child = node.getChild(i)
                if (child != null && child.isEditable && child.isVisibleToUser) {
                    realInput = child
                    break
                }
            }
            if (realInput != null) break
        }
        
        if (realInput == null) {
            // Fallback: 直接对原inputField设文本
            android.util.Log.w("AIA", "Soul fillAndSend: no editable field found, using clickable input")
            realInput = inputField
        }

        // 2. 设置文本
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val textSet = realInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        android.util.Log.d("AIA", "Soul fillAndSend: text set result=$textSet")

        // 3. 等发送按钮出现（Soul输入文字后AI助手按钮会变成发送按钮）
        kotlinx.coroutines.delay(500)
        val sendRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        
        // 尝试多种方式找发送按钮
        var sendButton: AccessibilityNodeInfo? = null
        
        // 方法1：btn_send ID
        val byId = sendRoot.findAccessibilityNodeInfosByViewId(PREFIX + "btn_send")
        sendButton = byId.firstOrNull { it.isClickable && it.isVisibleToUser }
        
        // 方法2：找输入框右侧的可点击元素（发送按钮应在et_sendmessage右侧）
        if (sendButton == null) {
            val inputBounds = android.graphics.Rect()
            realInput.getBoundsInScreen(inputBounds)
            val sendX = inputBounds.right + 30  // 输入框右边一点
            val sendY = inputBounds.centerY()
            
            val allClickable = mutableListOf<AccessibilityNodeInfo>()
            findClickableInArea(sendRoot, sendX - 60, inputBounds.top - 10, sendX + 120, inputBounds.bottom + 10, allClickable)
            for (node in allClickable) {
                val bounds = android.graphics.Rect()
                node.getBoundsInScreen(bounds)
                if (bounds.left >= inputBounds.right - 20) {
                    android.util.Log.d("AIA", "Soul fillAndSend: found send button by position at ${bounds.toShortString()}")
                    sendButton = node
                    break
                }
            }
        }
        
        if (sendButton == null) {
            // 方法3：找所有可点击元素，排除已知的（语音、AI助手、表情、+号）
            val allClickable = mutableListOf<AccessibilityNodeInfo>()
            findBottomClickables(sendRoot, allClickable)
            android.util.Log.d("AIA", "Soul fillAndSend: ${allClickable.size} bottom clickables found")
            // 输入文字后，原来的"AI助手"应变成"发送"
            for (node in allClickable) {
                val b = android.graphics.Rect()
                node.getBoundsInScreen(b)
                if (b.left > 700 && b.left < 900 && b.bottom > 2200) {
                    android.util.Log.d("AIA", "Soul fillAndSend: trying send at ${b.toShortString()}")
                    sendButton = node
                    break
                }
            }
        }

        if (sendButton != null) {
            sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            kotlinx.coroutines.delay(800)
            // 检查是否被禁言
            val checkRoot = service.rootInActiveWindow
            if (checkRoot != null && detectBanned(checkRoot)) return SendResult.BANNED
            return SendResult.SUCCESS
        }

        android.util.Log.w("AIA", "Soul fillAndSend: send button not found, trying keyboard ENTER")
        // 最后手段：尝试键盘回车
        // 通过输入法ACTION_SEND
        return SendResult.TIMEOUT
    }
    
    // 在指定区域内递归查找可点击节点
    private fun findClickableInArea(node: AccessibilityNodeInfo, left: Int, top: Int, right: Int, bottom: Int, results: MutableList<AccessibilityNodeInfo>) {
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.left >= left && bounds.right <= right && bounds.top >= top && bounds.bottom <= bottom && node.isClickable && node.isVisibleToUser) {
            results.add(node)
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findClickableInArea(it, left, top, right, bottom, results) }
        }
    }
    
    // 找底部区域所有可点击元素
    private fun findBottomClickables(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>) {
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.bottom > 2100 && node.isClickable && node.isVisibleToUser) {
            results.add(node)
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findBottomClickables(it, results) }
        }
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
        // 先尝试直接找未读标记
        var result = tryFindAndUnread(root, shouldClick)
        if (result != null) return result

        // 如果没找到，尝试滚动后再找（最多5次）
        android.util.Log.d("AIA", "Soul clickFirstUnread: no unread visible, trying scroll...")
        for (attempt in 1..5) {
            val scrolled = scrollConversationList(root)
            if (!scrolled) {
                android.util.Log.d("AIA", "Soul clickFirstUnread: cannot scroll, giving up")
                break
            }
            kotlinx.coroutines.delay(800)
            // 重新获取root（scroll后节点树会刷新）
            val newRoot = getFreshRoot() ?: continue
            result = tryFindAndUnread(newRoot, shouldClick)
            if (result != null) {
                android.util.Log.d("AIA", "Soul clickFirstUnread: found after scroll attempt $attempt")
                return result
            }
        }
        android.util.Log.d("AIA", "Soul clickFirstUnread: no unread found after scrolling")
        return null
    }

    // 从当前root查找并点击未读会话
    // 从当前root查找并点击未读会话
    // Soul badge ??? ImageView???? TextView?????? = ???
    private fun tryFindAndUnread(root: AccessibilityNodeInfo, shouldClick: Boolean): ConversationInfo? {
        val badges = root.findAccessibilityNodeInfosByViewId(PREFIX + "unread_msg_number")
        android.util.Log.d("AIA", "Soul tryFindAndUnread: found " + badges.size + " unread_msg_number nodes")
        if (badges.isEmpty()) return null

        var checkedBadges = 0
        var skippedNotVisible = 0
        var skippedNoChild = 0
        for (badge in badges) {
            if (!badge.isVisibleToUser) { skippedNotVisible++; continue }
            val hasRedDot = badge.childCount > 0
            checkedBadges++
            if (!hasRedDot) { skippedNoChild++; continue }

            android.util.Log.d("AIA", "Soul tryFindAndUnread: found badge with red dot")

            val conversationItem = findAncestorByViewId(badge, "item_content_root")
                ?: badge.parent?.parent?.parent ?: continue

            val name = readChildText(conversationItem, "name")
            val preview = readChildText(conversationItem, "message")
            val contactName = name ?: preview ?: "unknown"

            if (shouldClick) {
                val rect = android.graphics.Rect()
                conversationItem.getBoundsInScreen(rect)
                val cx = rect.centerX().toFloat()
                val cy = rect.centerY().toFloat()
                android.util.Log.d("AIA", "Soul tryFindAndUnread: gesture tap at (" + cx + ", " + cy + ")")
                val gesture = android.accessibilityservice.GestureDescription.Builder()
                    .addStroke(android.accessibilityservice.GestureDescription.StrokeDescription(
                        android.graphics.Path().apply { moveTo(cx, cy) },
                        0, 1
                    ))
                    .build()
                service.dispatchGesture(gesture, null, null)
            }

            return ConversationInfo(
                contactId = contactName,
                contactName = contactName,
                preview = preview ?: ""
            )
        }
        android.util.Log.d("AIA", "Soul tryFindAndUnread: checked=" + checkedBadges + " skippedNotVisible=" + skippedNotVisible + " skippedNoChild=" + skippedNoChild)
        return null
    }



    // 滚动会话列表
    private fun scrollConversationList(root: AccessibilityNodeInfo): Boolean {
        // Soul ?????????? recycler_view??? conversation_list?FrameLayout ?????
        val recyclerNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "recycler_view")
        for (node in recyclerNodes) {
            if (node.isScrollable && node.isVisibleToUser) {
                android.util.Log.d("AIA", "Soul scroll: using recycler_view")
                return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
        }
        // Fallback: ???????????
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val n = queue.removeFirst()
            if (n.isScrollable && n.isVisibleToUser) {
                android.util.Log.d("AIA", "Soul scroll: fallback " + (n.className?.toString() ?: "unknown"))
                return n.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
            for (i in 0 until n.childCount) {
                n.getChild(i)?.let { queue.add(it) }
            }
        }
        android.util.Log.w("AIA", "Soul scroll: no scrollable node found")
        return false
    }


    // 获取最新的root节点
    private fun getFreshRoot(): AccessibilityNodeInfo? {
        return service.rootInActiveWindow
    }
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
    // Soul 导航到消息列表
    // Soul 默认进入广场页，需要点底部"消息"栏目（图标无文字，需位置兜底）
    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

        // Method 0: BACK x5
        for (i in 1..5) {
            try {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                kotlinx.coroutines.delay(400)
                val r = service.rootInActiveWindow
                if (r != null && isInMessageList(r)) {
                    android.util.Log.d("AIA", "Soul nav: BACK x" + i + " success")
                    return
                }
            } catch (_: Exception) {}
        }

        // Method 1: click main_tab_msg by ID
        val freshRoot = service.rootInActiveWindow ?: return
        val tabNodes = freshRoot.findAccessibilityNodeInfosByViewId(PREFIX + "main_tab_msg")
        for (tab in tabNodes) {
            if (!tab.isClickable || !tab.isVisibleToUser) continue
            try {
                android.util.Log.d("AIA", "Soul nav: clicking main_tab_msg")
                tab.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                kotlinx.coroutines.delay(800)
                val r = service.rootInActiveWindow
                if (r != null && isInMessageList(r)) {
                    android.util.Log.d("AIA", "Soul nav: main_tab_msg success")
                    return
                }
            } catch (_: Exception) {}
        }

        // Method 2: single-point gesture tap at message tab center
        try {
            val cx = 756f
            val cy = 2244f
            android.util.Log.d("AIA", "Soul nav: gesture tap message tab")
            val gesture = android.accessibilityservice.GestureDescription.Builder()
                .addStroke(android.accessibilityservice.GestureDescription.StrokeDescription(
                    android.graphics.Path().apply { moveTo(cx, cy) },
                    0, 1
                ))
                .build()
            service.dispatchGesture(gesture, null, null)
            kotlinx.coroutines.delay(1000)
            val r = service.rootInActiveWindow
            if (r != null && isInMessageList(r)) {
                android.util.Log.d("AIA", "Soul nav: gesture tap success")
                return
            }
        } catch (_: Exception) {}

        // Method 3: restart Soul
        try {
            android.util.Log.d("AIA", "Soul nav: restarting Soul")
            bringToForeground(service)
            kotlinx.coroutines.delay(2000)
        } catch (_: Exception) {}

        android.util.Log.w("AIA", "Soul nav: FAILED")
    }

    
    // 找底部导航栏项目
    private fun findBottomNavItems(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>, screenHeight: Int) {
        val bounds = android.graphics.Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.bottom > screenHeight - 200 && bounds.top > screenHeight - 300 && node.isClickable && node.isVisibleToUser) {
            results.add(node)
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findBottomNavItems(it, results, screenHeight) }
        }
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
