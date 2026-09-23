package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.delay

/**
 * 语音消息处理 (补充页-语音图片表情处理方案)
 * 利用 App 自带的"转文字"按钮, 不用自己接 ASR
 */
object VoiceHandler {

    private const val TRANSCRIBE_WAIT_MS = 2000L

    /**
     * 尝试对语音消息点"转文字", 返回转出来的文字
     * 找不到按钮 → 返回 null (上层用兜底文案)
     */
    suspend fun tryTranscribe(messageNode: AccessibilityNodeInfo, platform: String): String? {
        val btn = findTranscribeButton(messageNode, platform)
        if (btn == null) return null

        // 点击转文字
        btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        delay(TRANSCRIBE_WAIT_MS)

        // 读转出来的文字
        return readTranscribedText(messageNode, platform)
    }

    /**
     * 找"转文字"按钮
     */
    private fun findTranscribeButton(node: AccessibilityNodeInfo, platform: String): AccessibilityNodeInfo? {
        // 在各平台的语音消息区域搜索"转文字"
        val keywords = listOf("转文字", "转文本", "转成文字", "转换文字")
        val results = mutableListOf<AccessibilityNodeInfo>()
        findClickableWithText(node, keywords, results)
        return results.firstOrNull()
    }

    /**
     * 读转文字结果
     * 转文字后, 附近会出现一个新 TextView 包含文字内容
     */
    private fun readTranscribedText(node: AccessibilityNodeInfo, platform: String): String? {
        // 在语音消息节点附近找新出现的文字
        val texts = mutableListOf<String>()

        // 同级兄弟节点
        var parent = node.parent
        if (parent != null) {
            collectTextFromChildren(parent, texts, excludeNode = node)
        }

        // 如果同级没找到, 扩大范围
        if (texts.isEmpty() && parent?.parent != null) {
            collectTextFromChildren(parent.parent!!, texts, excludeNode = parent)
        }

        return texts.firstOrNull { it.length > 1 }
    }

    // ── 工具方法 ──

    private fun findClickableWithText(
        node: AccessibilityNodeInfo,
        keywords: List<String>,
        results: MutableList<AccessibilityNodeInfo>
    ) {
        if (node.isClickable && node.isVisibleToUser) {
            val text = node.text?.toString()?.trim() ?: ""
            val desc = node.contentDescription?.toString()?.trim() ?: ""
            for (kw in keywords) {
                if (text.contains(kw) || desc.contains(kw)) {
                    results.add(node)
                    return
                }
            }
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { findClickableWithText(it, keywords, results) }
        }
    }

    private fun collectTextFromChildren(
        node: AccessibilityNodeInfo,
        texts: MutableList<String>,
        excludeNode: AccessibilityNodeInfo? = null
    ) {
        if (node == excludeNode) return
        if (node.className?.toString()?.contains("TextView") == true) {
            val t = node.text?.toString()?.trim() ?: ""
            if (t.isNotEmpty() && t.length in 2..500) texts.add(t)
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectTextFromChildren(it, texts, excludeNode) }
        }
    }
}