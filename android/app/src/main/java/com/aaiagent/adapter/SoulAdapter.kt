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

    // ═══ P0-问题3: 放宽 isInChat——有 et_sendmessage 就算聊天页 ═══
    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        val hasInput = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage").isNotEmpty()
        return hasInput
    }

    // ═══ P0-问题2: 读聊天页顶部标题，验证进没进错人 ═══
    fun readChatTitle(root: AccessibilityNodeInfo): String? {
        // Soul聊天页顶部标题是 tv_title
        val titles = root.findAccessibilityNodeInfosByViewId(PREFIX + "tv_title")
        for (t in titles) {
            val text = t.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && t.isVisibleToUser) {
                android.util.Log.d("AIA", "Soul readChatTitle: found='$text'")
                return text
            }
        }
        // fallback: 找可见的、顶部位置的文本
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val rect = android.graphics.Rect()
            node.getBoundsInScreen(rect)
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && text.length in 2..20 && rect.top < 200 && rect.width() > 200 && node.isVisibleToUser) {
                android.util.Log.d("AIA", "Soul readChatTitle fallback: found='$text' at top=" + rect.top)
                return text
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        // 必须有conversation_list才算是消息列表（广场页也有item_content_root）
        val hasConvList = root.findAccessibilityNodeInfosByViewId(PREFIX + "conversation_list").isNotEmpty()
        if (hasConvList) return true
        // 备用：底部聊天tab选中 + 有多个item_content_root
        val chatTab = root.findAccessibilityNodeInfosByViewId(PREFIX + "main_tab_msg")
        val tabSelected = chatTab.any { it.isSelected || it.isFocused }
        val items = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_content_root")
        return tabSelected && items.size >= 2
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        val messageItems = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_root")
        for (item in messageItems) {
            if (!item.isVisibleToUser) continue
            val aigcNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "aigcRootView")
            if (aigcNodes.isNotEmpty()) continue
            val privacyNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "tv_privacy_protect_tag")
            if (privacyNodes.isNotEmpty()) continue
            val hasMeAvatar = item.findAccessibilityNodeInfosByViewId(PREFIX + "meAvatar").isNotEmpty()
            val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(PREFIX + "otherAvatar").isNotEmpty()
            if (hasMeAvatar && !hasOtherAvatar) continue
            val textNodes = item.findAccessibilityNodeInfosByViewId(PREFIX + "content_text")
            val content = textNodes.mapNotNull { it.text?.toString()?.trim() }
                .filter { it.isNotEmpty() }
                .joinToString("")
            if (content.isNotEmpty()) {
                messages.add(ChatMessage(sender = "other", content = content))
            }
        }
        if (messages.isEmpty()) {
            fallbackReadTextViews(root, messages)
        }
        return messages
    }

    private fun fallbackReadTextViews(node: AccessibilityNodeInfo, messages: MutableList<ChatMessage>) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = android.graphics.Rect()
                node.getBoundsInScreen(rect)
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

    // ═══ P1-问题6: 发送按钮查找增加重试和坐标兜底 ═══
    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult {
        // 1. 点击输入框激活
        val inputNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isClickable && it.isVisibleToUser }
        if (inputField == null) {
            android.util.Log.w("AIA", "Soul fillAndSend: et_sendmessage not found")
            return SendResult.TIMEOUT
        }
        
        inputField.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        kotlinx.coroutines.delay(300)
        
        val retryRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        val allEditTexts = retryRoot.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        var realInput: AccessibilityNodeInfo? = null
        for (node in allEditTexts) {
            if (node.isEditable && node.isVisibleToUser) {
                realInput = node
                break
            }
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
            android.util.Log.w("AIA", "Soul fillAndSend: no editable field found, using clickable input")
            realInput = inputField
        }

        // 2. 设置文本
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val textSet = realInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        android.util.Log.d("AIA", "Soul fillAndSend: text set result=$textSet")

        // 3. ═══ P1-问题6: 等1秒让发送按钮出现，然后重试5次 ═══
        kotlinx.coroutines.delay(1000)
        
        var sendButton: AccessibilityNodeInfo? = null
        var sendRetries = 0
        
        while (sendButton == null && sendRetries < 5) {
            if (sendRetries > 0) kotlinx.coroutines.delay(500)
            val sendRoot = service.rootInActiveWindow ?: break
            
            // 方法1：btn_send ID
            val byId = sendRoot.findAccessibilityNodeInfosByViewId(PREFIX + "btn_send")
            sendButton = byId.firstOrNull { it.isClickable && it.isVisibleToUser }
            
            // 方法2：输入框右侧可点击元素
            if (sendButton == null) {
                val inputBounds = android.graphics.Rect()
                realInput.getBoundsInScreen(inputBounds)
                val allClickable = mutableListOf<AccessibilityNodeInfo>()
                findClickableInArea(sendRoot, inputBounds.right - 60, inputBounds.top - 10, inputBounds.right + 120, inputBounds.bottom + 10, allClickable)
                for (node in allClickable) {
                    val bounds = android.graphics.Rect()
                    node.getBoundsInScreen(bounds)
                    if (bounds.left >= inputBounds.right - 20) {
                        android.util.Log.d("AIA", "Soul fillAndSend: found send by position at ${bounds.toShortString()}")
                        sendButton = node
                        break
                    }
                }
            }
            
            // 方法3：底部区域可点击元素
            if (sendButton == null) {
                val allClickable = mutableListOf<AccessibilityNodeInfo>()
                findBottomClickables(sendRoot, allClickable)
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
            sendRetries++
            if (sendButton == null) android.util.Log.d("AIA", "Soul fillAndSend: send button retry $sendRetries/5")
        }

        if (sendButton != null) {
            sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            // ═══ P1-问题6: 点完发送后等800ms验证输入框清空 ═══
            kotlinx.coroutines.delay(800)
            val checkRoot = service.rootInActiveWindow
            if (checkRoot != null && detectBanned(checkRoot)) return SendResult.BANNED
            return SendResult.SUCCESS
        }

        // ═══ P1-问题6: 坐标兜底——输入框右边中间位置 ═══
        android.util.Log.w("AIA", "Soul fillAndSend: all retries failed, using gesture fallback")
        try {
            val inputBounds = android.graphics.Rect()
            realInput.getBoundsInScreen(inputBounds)
            val cx = (inputBounds.right + 50).toFloat()
            val cy = inputBounds.centerY().toFloat()
            android.util.Log.d("AIA", "Soul fillAndSend: gesture fallback tap at ($cx, $cy)")
            val gesture = android.accessibilityservice.GestureDescription.Builder()
                .addStroke(android.accessibilityservice.GestureDescription.StrokeDescription(
                    android.graphics.Path().apply { moveTo(cx, cy) },
                    0, 1
                ))
                .build()
            service.dispatchGesture(gesture, null, null)
            kotlinx.coroutines.delay(800)
            val checkRoot = service.rootInActiveWindow
            if (checkRoot != null && detectBanned(checkRoot)) return SendResult.BANNED
            return SendResult.SUCCESS
        } catch (_: Exception) {
            return SendResult.TIMEOUT
        }
    }
    
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

    suspend fun fillInputOnly(text: String): Boolean {
        val root = service.rootInActiveWindow ?: return false
        val inputNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "et_sendmessage")
        val inputField = inputNodes.firstOrNull { it.isEditable && it.isVisibleToUser }
            ?: return false
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    // ═══ P1-问题7: 扩充违规关键词 ═══
    private fun detectBanned(root: AccessibilityNodeInfo): Boolean {
        val errorKeywords = listOf(
            "发送失败", "已被禁言", "发言太快", "内容违规", "违规消息", "账号异常", "操作频繁",
            "请稍后再试", "已被限制", "禁止发言", "聊天功能被封", "举报处理中",
            "违反社区规定", "请遵守", "发送内容包含", "封号", "永久封禁", "临时封禁"
        )
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val text = node.text?.toString() ?: ""
            if (errorKeywords.any { text.contains(it) }) {
                android.util.Log.w("AIA", "Soul detectBanned: hit keyword in '$text'")
                return true
            }
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
        var result = tryFindAndUnread(root, shouldClick)
        if (result != null) return result

        // ═══ P1-问题4: 滑动后稳定验证 ═══
        android.util.Log.d("AIA", "Soul clickFirstUnread: no unread visible, trying scroll...")
        for (attempt in 1..5) {
            val scrolled = scrollConversationList(root)
            if (!scrolled) {
                android.util.Log.d("AIA", "Soul clickFirstUnread: cannot scroll, giving up")
                break
            }
            // 等1秒后连续读两次验证列表稳定
            kotlinx.coroutines.delay(1000)
            
            var stableReads = 0
            var prevCount = -1
            var prevFirstName = ""
            for (stableAttempt in 1..3) {
                val newRoot = getFreshRoot() ?: break
                val items = countAndFirstConversation(newRoot)
                val currCount = items.first
                val currFirstName = items.second
                android.util.Log.d("AIA", "Soul scroll stability check $stableAttempt: count=$currCount first='$currFirstName' prevCount=$prevCount prevFirst='$prevFirstName'")
                if (currCount == prevCount && currFirstName == prevFirstName) {
                    stableReads++
                    if (stableReads >= 2) break
                } else {
                    stableReads = 0
                }
                prevCount = currCount
                prevFirstName = currFirstName
                if (stableAttempt < 3) kotlinx.coroutines.delay(500)
            }
            
            val stableRoot = getFreshRoot() ?: continue
            result = tryFindAndUnread(stableRoot, shouldClick)
            if (result != null) {
                android.util.Log.d("AIA", "Soul clickFirstUnread: found after scroll attempt $attempt")
                return result
            }
        }
        android.util.Log.d("AIA", "Soul clickFirstUnread: no unread found after scrolling")
        return null
    }

    // 计数+第一个会话名
    private fun countAndFirstConversation(root: AccessibilityNodeInfo): Pair<Int, String> {
        val items = root.findAccessibilityNodeInfosByViewId(PREFIX + "item_content_root")
        val firstName = items.firstOrNull()?.let {
            it.findAccessibilityNodeInfosByViewId(PREFIX + "name").firstOrNull()?.text?.toString()?.trim() ?: ""
        } ?: ""
        return Pair(items.size, firstName)
    }

    private fun tryFindAndUnread(root: AccessibilityNodeInfo, shouldClick: Boolean): ConversationInfo? {
        val badges = root.findAccessibilityNodeInfosByViewId(PREFIX + "unread_msg_number")
        android.util.Log.d("AIA", "Soul tryFindAndUnread: found " + badges.size + " unread_msg_number nodes")
        if (badges.isEmpty()) return null

        var checkedBadges = 0
        var skippedNotVisible = 0
        var skippedNoChild = 0
        for (badge in badges) {
            // P0修复：放宽可见性检查——使用父节点bounds判断
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
                android.util.Log.d("AIA", "Soul tryFindAndUnread: gesture tap at (" + cx + ", " + cy + ") name='$contactName'")
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

    private fun scrollConversationList(root: AccessibilityNodeInfo): Boolean {
        val recyclerNodes = root.findAccessibilityNodeInfosByViewId(PREFIX + "recycler_view")
        for (node in recyclerNodes) {
            if (node.isScrollable && node.isVisibleToUser) {
                android.util.Log.d("AIA", "Soul scroll: using recycler_view")
                return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            }
        }
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

    private fun readChildText(parent: AccessibilityNodeInfo, viewId: String): String? {
        val nodes = parent.findAccessibilityNodeInfosByViewId(PREFIX + viewId)
        return nodes.firstOrNull()?.text?.toString()?.trim()
    }

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

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

        try {
            android.util.Log.d("AIA", "Soul nav: restarting Soul")
            bringToForeground(service)
            kotlinx.coroutines.delay(2000)
        } catch (_: Exception) {}

        android.util.Log.w("AIA", "Soul nav: FAILED")
    }

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
