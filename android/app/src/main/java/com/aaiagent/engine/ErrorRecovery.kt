package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.delay

/**
 * 错误恢复机制 (补充页 §五)
 * 任何一步失败, 先截图看当前在哪, 再决定怎么办
 * ═══ P2-问题10: MAX_RETRY 从 2 改为 3 ═══
 */
object ErrorRecovery {

    private const val MAX_RETRY = 3

    suspend fun retryClickConversation(
        adapter: PlatformAdapter,
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        contactFilter: (contactName: String, contactId: String) -> Boolean = { _, _ -> true }
    ): PlatformAdapter.ConversationInfo? {
        for (attempt in 1..MAX_RETRY) {
            RuntimeJournal.recovery("重试点会话(第${attempt}次)")

            adapter.navigateToMessageList(service, root)
            delay(500)

            val newRoot = service.rootInActiveWindow ?: break
            val info = adapter.clickFirstUnreadConversation(newRoot, shouldClick = true, contactFilter = contactFilter)
            if (info != null) {
                RuntimeJournal.recovery("重试成功")
                return info
            }
            delay(1000)
        }
        RuntimeJournal.recovery("重试失败, 放弃本次")
        return null
    }

    suspend fun recoverReadMessages(
        adapter: PlatformAdapter,
        service: AccessibilityService,
        contactFilter: (contactName: String, contactId: String) -> Boolean = { _, _ -> true }
    ): AccessibilityNodeInfo? {
        for (attempt in 1..MAX_RETRY) {
            RuntimeJournal.recovery("恢复读消息(第${attempt}次)")

            val root = service.rootInActiveWindow ?: break

            val page = detectPage(adapter, root)
            when (page) {
                PageType.CHAT -> {
                    RuntimeJournal.recovery("已在聊天页, 直接读")
                    return root
                }
                PageType.MESSAGE_LIST -> {
                    RuntimeJournal.recovery("在消息列表, 点会话")
                    val info = adapter.clickFirstUnreadConversation(root, shouldClick = true, contactFilter = contactFilter)
                    if (info != null) {
                        delay(800)
                        return service.rootInActiveWindow
                    }
                }
                PageType.MAIN_PAGE -> {
                    RuntimeJournal.recovery("在主页, 导航到消息列表")
                    adapter.navigateToMessageList(service, root)
                    delay(500)
                }
                PageType.SECONDARY_PAGE -> {
                    RuntimeJournal.recovery("在二级页, 先返回")
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    delay(300)
                }
                PageType.POPUP -> {
                    RuntimeJournal.recovery("检测到弹窗, 尝试关闭")
                    closePopup(service, root)
                    delay(300)
                }
                PageType.UNKNOWN -> {
                    RuntimeJournal.wrongPage("无法识别页面")
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    delay(300)
                }
            }
            delay(800)
        }
        return null
    }

    suspend fun recoverSend(
        adapter: PlatformAdapter,
        service: AccessibilityService
    ) {
        RuntimeJournal.recovery("恢复发送流程")
        val root = service.rootInActiveWindow ?: return

        val page = detectPage(adapter, root)
        when (page) {
            PageType.CHAT -> {
                RuntimeJournal.recovery("在聊天页但发送失败, 放弃")
            }
            PageType.POPUP -> {
                closePopup(service, root)
            }
            else -> {
                adapter.navigateToMessageList(service, root)
            }
        }
    }

    fun detectPagePublic(adapter: PlatformAdapter, root: AccessibilityNodeInfo): PageType {
        return detectPage(adapter, root)
    }

    private fun detectPage(adapter: PlatformAdapter, root: AccessibilityNodeInfo): PageType {
        if (adapter.isInChat(root)) return PageType.CHAT
        if (adapter.isInMessageList(root)) return PageType.MESSAGE_LIST

        val nodes = TreeCompressor.compressToList(root)

        val hasInput = nodes.any { it.editable && it.bounds.bottom > 1500 }
        val hasSendBtn = nodes.any {
            it.clickable && it.bounds.bottom > 1500 &&
            (it.text.contains("发送") || it.text.contains("send") || it.viewId.contains("send"))
        }
        if (hasInput && hasSendBtn) return PageType.CHAT

        val conversationItems = nodes.count { it.clickable && it.text.length in 2..20 }
        if (conversationItems >= 3) return PageType.MESSAGE_LIST

        val tabButtons = nodes.count {
            it.clickable && it.bounds.bottom > 2000 &&
            it.text.length in 1..5
        }
        if (tabButtons in 3..5) return PageType.MAIN_PAGE

        val hasBackArrow = nodes.any {
            it.clickable && it.bounds.top < 200 &&
            (it.text.isEmpty() || it.text.contains("返回") == true ||
             it.text.contains("back") == true)
        }
        val hasTitle = nodes.any { it.bounds.top < 200 && it.text.length in 2..20 && !it.clickable }
        if (hasBackArrow && hasTitle) return PageType.SECONDARY_PAGE

        // ═══ P2-问题9: 弹窗关键词扩充 ═══
        val popupKeywords = listOf("允许", "取消", "确定", "关闭", "知道了", "好的", "不再提示", "关闭广告")
        val dialog = nodes.any {
            it.clickable && popupKeywords.any { kw -> it.text.contains(kw) }
        }
        if (dialog) return PageType.POPUP

        return PageType.UNKNOWN
    }

    // ═══ P2-问题9: 弹窗关闭双保险——找关闭按钮 + 双击返回 ═══
    private fun closePopup(service: AccessibilityService, root: AccessibilityNodeInfo) {
        val nodes = TreeCompressor.compressToList(root)
        val closeKeywords = listOf("关闭", "取消", "X", "×", "确定", "知道了", "好的", "不再提示", "关闭广告", "允许")
        val closeNode = nodes.find {
            it.clickable && closeKeywords.any { kw -> it.text.contains(kw) }
        }
        if (closeNode != null) {
            val original = findNodeAt(root, closeNode.bounds)
            original?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
            // 找不到关闭按钮 → 双击返回键
            android.util.Log.d("AIA", "ErrorRecovery closePopup: no close button found, double back")
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            Thread.sleep(500)
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        }
    }

    private fun findNodeAt(node: AccessibilityNodeInfo, bounds: android.graphics.Rect): AccessibilityNodeInfo? {
        val nodeRect = android.graphics.Rect()
        node.getBoundsInScreen(nodeRect)
        if (nodeRect == bounds && node.isClickable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeAt(child, bounds)
            if (found != null) return found
        }
        return null
    }
}

enum class PageType {
    CHAT,
    MESSAGE_LIST,
    MAIN_PAGE,
    SECONDARY_PAGE,
    POPUP,
    UNKNOWN
}
