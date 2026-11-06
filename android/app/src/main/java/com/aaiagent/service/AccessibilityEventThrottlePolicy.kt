package com.aaiagent.service

/**
 * Soul 页面一次刷新会连续抛出很多内容变化事件。每次都遍历整棵无障碍树
 * 会把主线程占住，悬浮按钮看起来就像点不动。这里只合并频繁事件，
 * 页面真正切换时仍由窗口状态事件立即处理。
 */
object AccessibilityEventThrottlePolicy {
    const val CONTENT_CHANGE_INTERVAL_MS = 400L
    const val TREE_INSPECTION_INTERVAL_MS = 1_500L

    fun shouldHandleContentChange(nowMs: Long, lastHandledAtMs: Long): Boolean {
        return lastHandledAtMs <= 0L || nowMs - lastHandledAtMs >= CONTENT_CHANGE_INTERVAL_MS
    }

    fun shouldInspectTree(nowMs: Long, lastInspectedAtMs: Long): Boolean {
        return lastInspectedAtMs <= 0L || nowMs - lastInspectedAtMs >= TREE_INSPECTION_INTERVAL_MS
    }
}
