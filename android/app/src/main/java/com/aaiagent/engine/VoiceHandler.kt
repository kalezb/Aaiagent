package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.delay

/**
 * Converts unanswered Soul voice messages while preserving each transcript's
 * owning message item. Soul may expose an inline "转文字" action, or a native
 * long-press menu on older versions.
 */
object VoiceHandler {
    private const val prefix = "cn.soulapp.android:id/"
    private const val MAX_TRANSCRIPTION_ROUNDS = 8

    suspend fun transcribeIncomingVoices(
        service: android.accessibilityservice.AccessibilityService,
        root: AccessibilityNodeInfo,
        isIncomingItem: (AccessibilityNodeInfo) -> Boolean
    ): PlatformAdapter.VoiceTranscriptionResult {
        var currentRoot = root

        repeat(MAX_TRANSCRIPTION_ROUNDS) {
            val before = incomingVoiceItems(currentRoot, isIncomingItem)
            if (before.isEmpty() || before.all(::hasTranscription)) return summarize(before)

            val inlineCandidate = before.firstOrNull {
                !hasTranscription(it) && findInlineTranscriptionAction(it) != null
            }
            val worked = if (inlineCandidate != null) {
                clickInlineTranscription(inlineCandidate)
            } else {
                val longPressCandidate = before.firstOrNull { !hasTranscription(it) }
                longPressCandidate != null && longPressTranscription(service, longPressCandidate)
            }

            delay(if (inlineCandidate != null) 2_500L else 1_800L)
            currentRoot = service.rootInActiveWindow ?: currentRoot

            val after = incomingVoiceItems(currentRoot, isIncomingItem)
            val beforeCount = before.count(::hasTranscription)
            val afterCount = after.count(::hasTranscription)
            if (!worked && afterCount <= beforeCount) return summarize(after)
        }

        return summarize(incomingVoiceItems(service.rootInActiveWindow ?: root, isIncomingItem))
    }

    private fun incomingVoiceItems(
        root: AccessibilityNodeInfo,
        isIncomingItem: (AccessibilityNodeInfo) -> Boolean
    ): List<AccessibilityNodeInfo> {
        val allItems = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")
            .filter { it.isVisibleToUser }
        val lastSelfIndex = allItems.indexOfLast { !isIncomingItem(it) }
        val unanswered = allItems.drop(lastSelfIndex + 1)
        return unanswered.filter { item ->
            isIncomingItem(item) &&
                item.findAccessibilityNodeInfosByViewId(prefix + "voice_bubble")
                    .any { it.isVisibleToUser }
        }
    }

    private fun hasTranscription(item: AccessibilityNodeInfo): Boolean {
        return item.findAccessibilityNodeInfosByViewId(prefix + "audioContent")
            .any { it.isVisibleToUser && !it.text.isNullOrBlank() }
    }

    private suspend fun clickInlineTranscription(
        item: AccessibilityNodeInfo
    ): Boolean {
        val action = findInlineTranscriptionAction(item) ?: return false
        return performClick(action)
    }

    private fun findInlineTranscriptionAction(item: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        item.findAccessibilityNodeInfosByViewId(prefix + "voice_action_button")
            .firstOrNull { it.isVisibleToUser }
            ?.let { return actionableNode(it) }

        return item.findAccessibilityNodeInfosByViewId(prefix + "tvTranslateText")
            .firstOrNull { it.isVisibleToUser }
            ?.let(::actionableNode)
    }

    private suspend fun longPressTranscription(
        service: android.accessibilityservice.AccessibilityService,
        item: AccessibilityNodeInfo
    ): Boolean {
        val voiceNode = item.findAccessibilityNodeInfosByViewId(prefix + "voice_bubble")
            .firstOrNull { it.isVisibleToUser }
            ?: return false

        GestureMonitor.onAutomationActionStarted()
        val longClicked = voiceNode.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
        GestureMonitor.onAutomationActionFinished()
        if (!longClicked) return false

        delay(900)
        val action = activeRoots(service)
            .asSequence()
            .mapNotNull { findActionableByText(it, listOf("转文字", "转文本", "文字转换")) }
            .firstOrNull()
        if (action == null) {
            service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            return false
        }

        val clicked = performClick(action)
        if (!clicked) {
            service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        }
        return clicked
    }

    private fun performClick(
        node: AccessibilityNodeInfo
    ): Boolean {
        GestureMonitor.onAutomationActionStarted()
        val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        GestureMonitor.onAutomationActionFinished()
        return clicked
    }

    private fun activeRoots(
        service: android.accessibilityservice.AccessibilityService
    ): List<AccessibilityNodeInfo> {
        return buildList {
            service.rootInActiveWindow?.let(::add)
            service.windows.forEach { window -> window.root?.let(::add) }
        }.distinctBy { System.identityHashCode(it) }
    }

    private fun findActionableByText(
        root: AccessibilityNodeInfo,
        keywords: List<String>
    ): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isVisibleToUser) {
                val text = node.text?.toString().orEmpty()
                val description = node.contentDescription?.toString().orEmpty()
                if (keywords.any { text.contains(it) || description.contains(it) }) {
                    return actionableNode(node)
                }
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return null
    }

    private fun actionableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        while (current != null && current != current.parent) {
            if (current.isClickable && current.isVisibleToUser) return current
            current = current.parent
        }
        return null
    }

    private fun summarize(
        items: List<AccessibilityNodeInfo>
    ): PlatformAdapter.VoiceTranscriptionResult {
        return PlatformAdapter.VoiceTranscriptionResult(
            total = items.size,
            transcribed = items.count(::hasTranscription)
        )
    }
}
