package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.delay

/**
 * 错误恢复机制 (补充页 §五)
 * 任何一步失败, 先截图看当前在哪, 再决定怎么办
 */
object ErrorRecovery {

    private const val MAX_RETRY = 2

    /**
     * 点未读会话失败 → 退回消息列表重试
     */
    suspend fun retryClickConversation(
        adapter: PlatformAdapter,
        service: AccessibilityService,
        root: AccessibilityNodeInfo
    ): PlatformAdapter.ConversationInfo? {
        for (attempt in 1..MAX_RETRY) {
            RuntimeJournal.recovery("重试点会话 (第${attempt}次)")

            // 先退回消息列表
            adapter.navigateToMessageList(service, root)
            delay(500)

            val newRoot = service.rootInActiveWindow ?: break
            val info = adapter.clickFirstUnreadConversation(newRoot, shouldClick = true)
            if (info != null) {
                RuntimeJournal.recovery("重试成功")
                return info
            }
            delay(800)
        }
        RuntimeJournal.recovery("重试失败, 放弃本次")
        return null
    }

    /**
     * 读消息失败 → 检测当前在哪 → 导航回正确页面
     */
    suspend fun recoverReadMessages(
        adapter: PlatformAdapter,
        service: AccessibilityService
    ): AccessibilityNodeInfo? {
        for (attempt in 1..MAX_RETRY) {
            RuntimeJournal.recovery("恢复读消息 (第${attempt}次)")

            val root = service.rootInActiveWindow ?: break

            // 检测当前页面
            val page = detectPage(adapter, root)
            when (page) {
                PageType.CHAT -> {
                    RuntimeJournal.recovery("已在聊天页, 直接读")
                    return root
                }
                PageType.MESSAGE_LIST -> {
                    RuntimeJournal.recovery("在消息列表, 点会话")
                    val info = adapter.clickFirstUnreadConversation(root, shouldClick = true)
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

    /**
     * 发送消息失败 → 检查页面 → 恢复
     */
    suspend fun recoverSend(
        adapter: PlatformAdapter,
        service: AccessibilityService
    ) {
        RuntimeJournal.recovery("恢复发送流程")
        val root = service.rootInActiveWindow ?: return

        val page = detectPage(adapter, root)
        when (page) {
            PageType.CHAT -> {
                // 在聊天页但发送失败, 可能是输入框问题, 放弃
                RuntimeJournal.recovery("在聊天页但发送失败, 放弃")
            }
            PageType.POPUP -> {
                closePopup(service, root)
            }
            else -> {
                // 不在聊天页了, 导航回去
                adapter.navigateToMessageList(service, root)
            }
        }
    }

    /**
     * 公开的页面检测 —— 供 AccessibilityService 等外部调用
     */
    fun detectPagePublic(adapter: PlatformAdapter, root: AccessibilityNodeInfo): PageType {
        return detectPage(adapter, root)
    }

    /**
     * 检测当前页面类型 —— 第二层启发式规则 (补充页 §一)
     * View ID 认不出来时用这个兜底
     */
    private fun detectPage(adapter: PlatformAdapter, root: AccessibilityNodeInfo): PageType {
        // 先用 View ID 快判
        if (adapter.isInChat(root)) return PageType.CHAT
        if (adapter.isInMessageList(root)) return PageType.MESSAGE_LIST

        // View ID 失效 → 启发式规则
        val nodes = TreeCompressor.compressToList(root)

        // 规则: 屏幕底部有输入框(EditText) + 发送按钮 → 聊天页
        val hasInput = nodes.any { it.editable && it.bounds.bottom > 1500 }
        val hasSendBtn = nodes.any {
            it.clickable && it.bounds.bottom > 1500 &&
            (it.text.contains("发送") || it.text.contains("send") || it.viewId.contains("send"))
        }
        if (hasInput && hasSendBtn) return PageType.CHAT

        // 规则: 多个会话项 → 消息列表
        val conversationItems = nodes.count { it.clickable && it.text.length in 2..20 }
        if (conversationItems >= 3) return PageType.MESSAGE_LIST

        // 规则: 底部有tab按钮(3-5个) → 主页面
        val tabButtons = nodes.count {
            it.clickable && it.bounds.bottom > 2000 &&
            it.text.length in 1..5
        }
        if (tabButtons in 3..5) return PageType.MAIN_PAGE

        // 规则: 顶部有返回箭头 + 标题 → 二级页
        val hasBackArrow = nodes.any {
            it.clickable && it.bounds.top < 200 &&
            (it.text.isEmpty() || it.text.contains("返回") == true ||
             it.text.contains("back") == true)
        }
        val hasTitle = nodes.any { it.bounds.top < 200 && it.text.length in 2..20 && !it.clickable }
        if (hasBackArrow && hasTitle) return PageType.SECONDARY_PAGE

        // 规则: 有对话框/权限弹窗特征 → 弹窗
        val dialog = nodes.any {
            it.clickable && (it.text.contains("允许") || it.text.contains("取消") ||
            it.text.contains("确定") || it.text.contains("关闭"))
        }
        if (dialog) return PageType.POPUP

        return PageType.UNKNOWN
    }

    private fun closePopup(service: AccessibilityService, root: AccessibilityNodeInfo) {
        val nodes = TreeCompressor.compressToList(root)
        // 找"关闭"/"取消"/"X"按钮
        val closeNode = nodes.find {
            it.clickable && (it.text.contains("关闭") || it.text.contains("取消") ||
            it.text == "X" || it.text == "×")
        }
        if (closeNode != null) {
            val original = findNodeAt(root, closeNode.bounds)
            original?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } else {
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

/**
 * 页面类型 —— 三层识别机制 (补充页 §一)
 */
enum class PageType {
    /** 聊天页（第一层: View ID 匹配） */
    CHAT,
    /** 消息列表（第一层: View ID 匹配） */
    MESSAGE_LIST,
    /** 主页面（第二层: 底部 tab 按钮） */
    MAIN_PAGE,
    /** 二级页面（第二层: 顶部返回箭头+标题） */
    SECONDARY_PAGE,
    /** 弹窗/对话框 */
    POPUP,
    /** 无法识别, 需要第三层视觉兜底 */
    UNKNOWN
}