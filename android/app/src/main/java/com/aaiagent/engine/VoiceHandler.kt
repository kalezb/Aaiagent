package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.delay

/**
 * Soul voice messages can expose a native transcription action. This helper
 * uses that action first and returns null when the menu is drawn outside the
 * accessibility tree. The engine then falls back to screenshot vision or a
 * safe text reply.
 */
object VoiceHandler {
    private const val prefix = "cn.soulapp.android:id/"

    suspend fun tryTranscribe(
        service: android.accessibilityservice.AccessibilityService,
        root: AccessibilityNodeInfo,
        platform: String
    ): String? {
        if (platform != "soul") return null
        val voiceNode = root.findAccessibilityNodeInfosByViewId(prefix + "voice_bubble")
            .lastOrNull { it.isVisibleToUser }
            ?: return null

        GestureMonitor.onAutomationActionStarted()
        val longClicked = voiceNode.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
        GestureMonitor.onAutomationActionFinished()
        if (!longClicked) return null
        delay(900)

        val menuRoot = climbToRoot(voiceNode) ?: root
        val transcribeButton = findClickableByText(
            menuRoot,
            listOf("转文字", "转文本", "文字转换")
        ) ?: run {
            service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            return null
        }

        GestureMonitor.onAutomationActionStarted()
        val clicked = transcribeButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        GestureMonitor.onAutomationActionFinished()
        if (!clicked) return null
        delay(1_800)

        val refreshedRoot = climbToRoot(voiceNode) ?: menuRoot
        val item = findAncestorByViewId(refreshedRoot, voiceNode, "item_root") ?: refreshedRoot
        return collectText(item, voiceNode)
            .firstOrNull { it.length in 2..500 && !it.contains("转文字") }
    }

    private fun findClickableByText(
        node: AccessibilityNodeInfo,
        keywords: List<String>
    ): AccessibilityNodeInfo? {
        if (node.isClickable && node.isVisibleToUser) {
            val text = node.text?.toString().orEmpty()
            val description = node.contentDescription?.toString().orEmpty()
            if (keywords.any { text.contains(it) || description.contains(it) }) return node
        }
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            findClickableByText(child, keywords)?.let { return it }
        }
        return null
    }

    private fun collectText(root: AccessibilityNodeInfo, excluded: AccessibilityNodeInfo): List<String> {
        val result = mutableListOf<String>()
        fun visit(node: AccessibilityNodeInfo) {
            if (node == excluded) return
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty()) result.add(text)
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(::visit)
            }
        }
        visit(root)
        return result
    }

    private fun findAncestorByViewId(
        root: AccessibilityNodeInfo,
        node: AccessibilityNodeInfo,
        viewId: String
    ): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        while (current != null) {
            if (current.findAccessibilityNodeInfosByViewId(prefix + viewId).isNotEmpty()) return current
            if (current == root) return null
            current = current.parent
        }
        return null
    }

    private fun climbToRoot(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo = node
        var parent = current.parent
        while (parent != null) {
            current = parent
            parent = current.parent
        }
        return current
    }
}
