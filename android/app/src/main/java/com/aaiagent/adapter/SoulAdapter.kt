package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.ListSnapshot
import com.aaiagent.adapter.PlatformAdapter.ScrollDirection
import com.aaiagent.adapter.PlatformAdapter.SendResult
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.GestureMonitor
import kotlinx.coroutines.delay

class SoulAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "cn.soulapp.android"

    private val prefix = "cn.soulapp.android:id/"
    private var emptyScanStreak = 0

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName &&
            root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage").isNotEmpty()
    }

    override fun readChatTitle(root: AccessibilityNodeInfo): String? {
        val titles = root.findAccessibilityNodeInfosByViewId(prefix + "tv_title")
        for (node in titles) {
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && node.isVisibleToUser) return text
        }

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && text.length in 2..24 &&
                rect.top in 40..240 && rect.width() > 160 && node.isVisibleToUser
            ) {
                return text
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return null
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        if (root.packageName?.toString() != packageName) return false
        if (root.findAccessibilityNodeInfosByViewId(prefix + "conversation_list").isNotEmpty()) return true
        val chatTab = root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
        val tabSelected = chatTab.any { it.isSelected || it.isFocused }
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
        return tabSelected && items.size >= 2
    }

    override fun listSnapshot(root: AccessibilityNodeInfo): ListSnapshot {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .filter { it.isVisibleToUser }
        if (items.isEmpty()) return ListSnapshot()
        return ListSnapshot(
            itemCount = items.size,
            firstConversation = readChildText(items.first(), "name") ?: "",
            lastConversation = readChildText(items.last(), "name") ?: ""
        )
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        val screenWidth = service.resources.displayMetrics.widthPixels
        val messageItems = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")

        for (item in messageItems) {
            if (!item.isVisibleToUser) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "aigcRootView").isNotEmpty()) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag").isNotEmpty()) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "item_roote_snap_exchange_photo").isNotEmpty()) continue

            val hasSelfAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()
            val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "otherAvatar").isNotEmpty()
            val bounds = Rect()
            item.getBoundsInScreen(bounds)
            val sender = when {
                hasSelfAvatar && !hasOtherAvatar -> "self"
                hasOtherAvatar -> "other"
                bounds.centerX() > screenWidth / 2 -> "self"
                else -> "other"
            }

            val text = item.findAccessibilityNodeInfosByViewId(prefix + "content_text")
                .mapNotNull { it.text?.toString()?.trim() }
                .filter { it.isNotEmpty() }
                .joinToString("")

            val type = when {
                item.findAccessibilityNodeInfosByViewId(prefix + "voice_bubble").isNotEmpty() -> "voice"
                item.findAccessibilityNodeInfosByViewId(prefix + "image").isNotEmpty() -> "image"
                item.findAccessibilityNodeInfosByViewId(prefix + "image_content").isNotEmpty() -> "image"
                item.findAccessibilityNodeInfosByViewId(prefix + "chat_image_url").isNotEmpty() -> "image"
                item.findAccessibilityNodeInfosByViewId(prefix + "gif_intimacy").isNotEmpty() -> "sticker"
                text.isNotEmpty() -> "text"
                else -> "unknown"
            }

            val content = when {
                text.isNotEmpty() -> text
                type == "voice" -> "[语音]"
                type == "image" -> "[图片]"
                type == "sticker" -> "[表情]"
                else -> ""
            }
            if (content.isNotEmpty()) messages.add(ChatMessage(sender, content, type))
        }

        if (messages.isEmpty()) fallbackReadTextViews(root, messages, screenWidth)
        return messages
    }

    override fun readVisualTargetBounds(root: AccessibilityNodeInfo): Rect? {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")
        for (item in items.asReversed()) {
            if (!item.isVisibleToUser) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "aigcRootView").isNotEmpty()) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag").isNotEmpty()) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "item_roote_snap_exchange_photo").isNotEmpty()) continue
            val hasSelfAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()
            val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "otherAvatar").isNotEmpty()
            if (hasSelfAvatar && !hasOtherAvatar) continue

            val targets = listOf("image", "image_content", "chat_image_url", "gif_intimacy", "voice_bubble")
            for (target in targets) {
                val node = item.findAccessibilityNodeInfosByViewId(prefix + target)
                    .firstOrNull { it.isVisibleToUser }
                    ?: continue
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (rect.width() > 0 && rect.height() > 0) return rect
            }
        }
        return null
    }

    private fun fallbackReadTextViews(
        node: AccessibilityNodeInfo,
        messages: MutableList<ChatMessage>,
        screenWidth: Int
    ) {
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (rect.top > 240 && rect.bottom < 2140) {
                    messages.add(ChatMessage(if (rect.left > screenWidth / 2) "self" else "other", text))
                }
            }
        }
        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { fallbackReadTextViews(it, messages, screenWidth) }
        }
    }

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?
    ): SendResult {
        var currentRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        if (!isInChat(currentRoot)) return SendResult.NOT_VERIFIED
        if (!titleMatches(currentRoot, expectedContactName)) {
            android.util.Log.w("AIA", "Soul send blocked: conversation title mismatch, expected=$expectedContactName")
            return SendResult.NOT_VERIFIED
        }

        val beforeSelfCount = readMessages(currentRoot).count { it.sender == "self" }
        val input = findEditableInput(currentRoot) ?: return SendResult.TIMEOUT
        if (!setTextAndVerify(input, text)) return SendResult.NOT_VERIFIED

        currentRoot = service.rootInActiveWindow ?: return SendResult.NOT_VERIFIED
        if (!titleMatches(currentRoot, expectedContactName)) return SendResult.NOT_VERIFIED

        delay(700)
        val sendButton = findSendButtonWithRetry(input)
        val clicked = if (sendButton != null) {
            tapNode(sendButton)
        } else {
            tapSendFallback(input)
        }
        if (!clicked) return SendResult.TIMEOUT

        val verified = verifySent(text, beforeSelfCount, expectedContactName)
        if (verified == SendResult.BANNED) return SendResult.BANNED
        return verified
    }

    suspend fun fillInputOnly(text: String, expectedContactName: String? = null): Boolean {
        val root = service.rootInActiveWindow ?: return false
        if (!isInChat(root) || !titleMatches(root, expectedContactName)) return false
        val input = findEditableInput(root) ?: return false
        return setTextAndVerify(input, text)
    }

    private fun findEditableInput(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage")
        for (node in candidates) {
            if (!node.isVisibleToUser) continue
            if (node.isEditable) return node
            for (index in 0 until node.childCount) {
                val child = node.getChild(index)
                if (child != null && child.isEditable && child.isVisibleToUser) return child
            }
        }
        return candidates.firstOrNull { it.isVisibleToUser }
    }

    private suspend fun setTextAndVerify(input: AccessibilityNodeInfo, text: String): Boolean {
        repeat(3) { attempt ->
            GestureMonitor.onAutomationActionStarted()
            input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(220)

            val freshInput = service.rootInActiveWindow?.let(::findEditableInput) ?: input
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            val accepted = freshInput.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            delay(250)
            GestureMonitor.onAutomationActionFinished()

            val actual = freshInput.text?.toString()?.trim()
            if (accepted && actual == text.trim()) return true
            android.util.Log.w("AIA", "Soul set text verify failed attempt=${attempt + 1}, actual=$actual")
        }
        return false
    }

    private suspend fun findSendButtonWithRetry(input: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        repeat(5) { attempt ->
            if (attempt > 0) delay(500)
            val root = service.rootInActiveWindow ?: return@repeat
            val byId = root.findAccessibilityNodeInfosByViewId(prefix + "btn_send")
                .asSequence()
                .mapNotNull(::actionableNode)
                .firstOrNull { it.isVisibleToUser }
            if (byId != null) return byId

            val inputBounds = Rect()
            input.getBoundsInScreen(inputBounds)
            val candidates = mutableListOf<AccessibilityNodeInfo>()
            collectClickableNodes(root, candidates)
            candidates.firstOrNull {
                val bounds = Rect()
                it.getBoundsInScreen(bounds)
                bounds.left >= inputBounds.right - 30 &&
                    bounds.bottom >= inputBounds.top &&
                    bounds.top <= inputBounds.bottom + 80
            }?.let { return it }
        }
        return null
    }

    private fun actionableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(3) {
            val candidate = current ?: return null
            if (candidate.isClickable && candidate.isVisibleToUser) return candidate
            current = candidate.parent
        }
        return node.takeIf { it.isVisibleToUser }
    }

    private suspend fun tapSendFallback(input: AccessibilityNodeInfo): Boolean {
        val bounds = Rect()
        input.getBoundsInScreen(bounds)
        val screenWidth = service.resources.displayMetrics.widthPixels
        val screenHeight = service.resources.displayMetrics.heightPixels
        val x = (bounds.right + 55).coerceIn(40, screenWidth - 40).toFloat()
        val y = bounds.centerY().coerceIn(40, screenHeight - 40).toFloat()
        android.util.Log.w("AIA", "Soul send fallback tap x=$x y=$y")
        return performTap(x, y)
    }

    private suspend fun verifySent(
        text: String,
        beforeSelfCount: Int,
        expectedContactName: String?
    ): SendResult {
        repeat(3) { attempt ->
            delay(if (attempt == 0) 800 else 600)
            val root = service.rootInActiveWindow ?: return@repeat
            if (detectBanned(root)) return SendResult.BANNED
            if (!isInChat(root) || !titleMatches(root, expectedContactName)) {
                return SendResult.NOT_VERIFIED
            }

            val selfMessages = readMessages(root).filter { it.sender == "self" }
            val expected = compact(text)
            val matched = selfMessages.size > beforeSelfCount &&
                selfMessages.takeLast(4).any { compact(it.content) == expected }
            if (matched) return SendResult.SUCCESS
        }
        return SendResult.NOT_VERIFIED
    }

    private fun titleMatches(root: AccessibilityNodeInfo, expectedContactName: String?): Boolean {
        if (expectedContactName.isNullOrBlank()) return true
        return ConversationIdentity.matches(expectedContactName, readChatTitle(root))
    }

    private fun compact(value: String): String = value.replace(Regex("\\s+"), "").trim()

    private fun detectBanned(root: AccessibilityNodeInfo): Boolean {
        val keywords = listOf(
            "发送失败", "已被禁言", "发言太快", "内容违规", "违规消息", "账号异常", "操作频繁",
            "请稍后再试", "已被限制", "禁止发言", "聊天功能被封", "举报处理中",
            "违反社区规定", "请遵守", "发送内容包含", "封号", "永久封禁", "临时封禁"
        )
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val text = node.text?.toString() ?: ""
            if (keywords.any(text::contains)) return true
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return false
    }

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean
    ): ConversationInfo? {
        tryFindUnread(root, shouldClick)?.let {
            emptyScanStreak = 0
            return it
        }

        emptyScanStreak++
        val topRoot = scrollListToTop(root)
        tryFindUnread(topRoot, shouldClick)?.let {
            emptyScanStreak = 0
            return it
        }

        if (emptyScanStreak < FULL_PATROL_AFTER_EMPTY_SCANS) return null

        emptyScanStreak = 0
        var currentRoot = topRoot
        repeat(MAX_PATROL_SCROLLS) {
            if (!scrollConversationList(currentRoot, ScrollDirection.FORWARD)) return@repeat
            currentRoot = waitForStableListAfterScroll() ?: service.rootInActiveWindow ?: return@repeat
            tryFindUnread(currentRoot, shouldClick)?.let { return it }
        }
        scrollListToTop(currentRoot)
        return null
    }

    private fun tryFindUnread(root: AccessibilityNodeInfo, shouldClick: Boolean): ConversationInfo? {
        val badges = root.findAccessibilityNodeInfosByViewId(prefix + "unread_msg_number")
        for (badge in badges) {
            if (!badgeHasUnread(badge)) continue
            val item = findAncestorByViewId(badge, "item_content_root")
                ?: badge.parent?.parent?.parent
                ?: continue
            val name = readChildText(item, "name")
            val preview = readChildText(item, "message") ?: ""
            val contactName = name ?: preview.ifEmpty { "unknown" }

            if (shouldClick) {
                val target = item.takeIf { it.isClickable && it.isVisibleToUser } ?: item
                if (!tapNode(target)) {
                    return ConversationInfo(contactName, contactName, preview)
                }
            }
            return ConversationInfo(
                contactId = contactName,
                contactName = contactName,
                preview = preview
            )
        }
        return null
    }

    private fun badgeHasUnread(badge: AccessibilityNodeInfo): Boolean {
        val text = badge.text?.toString()?.trim() ?: ""
        val description = badge.contentDescription?.toString()?.trim() ?: ""
        if (text.toIntOrNull()?.let { it > 0 } == true) return true
        if (description.contains("未读") || description.contains("unread", ignoreCase = true)) return true
        return badge.childCount > 0 && (badge.isVisibleToUser || badge.parent?.isVisibleToUser == true)
    }

    override fun scrollConversationList(root: AccessibilityNodeInfo, direction: ScrollDirection): Boolean {
        val action = if (direction == ScrollDirection.FORWARD) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        }
        val recycler = root.findAccessibilityNodeInfosByViewId(prefix + "recycler_view")
            .firstOrNull { it.isScrollable && it.isVisibleToUser }
        if (recycler != null) {
            GestureMonitor.onAutomationActionStarted()
            val result = recycler.performAction(action)
            GestureMonitor.onAutomationActionFinished()
            return result
        }

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable && node.isVisibleToUser) {
                GestureMonitor.onAutomationActionStarted()
                val result = node.performAction(action)
                GestureMonitor.onAutomationActionFinished()
                return result
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return false
    }

    private suspend fun waitForStableListAfterScroll(): AccessibilityNodeInfo? {
        delay(1_000)
        var previous = ListSnapshot(-1, "", "")
        var stableReads = 0
        repeat(3) { attempt ->
            val root = service.rootInActiveWindow ?: return null
            val current = listSnapshot(root)
            if (current == previous) stableReads++ else stableReads = 0
            if (stableReads >= 2) return root
            previous = current
            if (attempt < 2) delay(500)
        }
        return service.rootInActiveWindow
    }

    private suspend fun scrollListToTop(root: AccessibilityNodeInfo): AccessibilityNodeInfo {
        var current = root
        repeat(MAX_TOP_REWIND_SCROLLS) {
            if (!scrollConversationList(current, ScrollDirection.BACKWARD)) return current
            delay(450)
            current = service.rootInActiveWindow ?: return current
        }
        return current
    }

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

        repeat(3) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(450)
            val fresh = service.rootInActiveWindow
            if (fresh != null && isInMessageList(fresh)) return
        }

        val freshRoot = service.rootInActiveWindow ?: return
        val tab = freshRoot.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
            .firstOrNull { it.isVisibleToUser }
        if (tab != null && tapNode(tab)) {
            delay(800)
            if (service.rootInActiveWindow?.let(::isInMessageList) == true) return
        }

        performTap(756f, 2244f)
        delay(1_000)
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        val intent = service.packageManager.getLaunchIntentForPackage(packageName) ?: return
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        service.startActivity(intent)
        delay(1_500)
    }

    private fun tapNode(node: AccessibilityNodeInfo): Boolean {
        GestureMonitor.onAutomationActionStarted()
        val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (clicked) {
            GestureMonitor.onAutomationActionFinished()
            return true
        }
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val result = if (bounds.width() > 0 && bounds.height() > 0) {
            val screenWidth = service.resources.displayMetrics.widthPixels
            val screenHeight = service.resources.displayMetrics.heightPixels
            performTap(
                bounds.centerX().coerceIn(20, screenWidth - 20).toFloat(),
                bounds.centerY().coerceIn(20, screenHeight - 20).toFloat()
            )
        } else {
            false
        }
        GestureMonitor.onAutomationActionFinished()
        return result
    }

    private fun performTap(x: Float, y: Float): Boolean {
        GestureMonitor.onAutomationActionStarted()
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 0L, 1L))
            .build()
        val result = service.dispatchGesture(gesture, null, null)
        GestureMonitor.onAutomationActionFinished()
        return result
    }

    private fun collectClickableNodes(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>) {
        if (node.isClickable && node.isVisibleToUser) results.add(node)
        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { collectClickableNodes(it, results) }
        }
    }

    private fun findAncestorByViewId(node: AccessibilityNodeInfo, targetId: String): AccessibilityNodeInfo? {
        var current = node.parent
        while (current != null) {
            val found = current.findAccessibilityNodeInfosByViewId(prefix + targetId)
            if (found.isNotEmpty()) return found.first()
            current = current.parent
        }
        return null
    }

    private fun readChildText(parent: AccessibilityNodeInfo, viewId: String): String? {
        return parent.findAccessibilityNodeInfosByViewId(prefix + viewId)
            .firstOrNull { it.text?.toString()?.isNotBlank() == true }
            ?.text
            ?.toString()
            ?.trim()
    }

    companion object {
        private const val FULL_PATROL_AFTER_EMPTY_SCANS = 3
        private const val MAX_PATROL_SCROLLS = 3
        private const val MAX_TOP_REWIND_SCROLLS = 3
    }
}
