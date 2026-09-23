package com.aaiagent.engine

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * UI 树压缩器 (补充页 §二)
 * 规则: 只保留有文字/可点击节点, 深度限制15层, 去重复属性
 * 效果: 原始~5000 token → 压缩后~500 token
 */
object TreeCompressor {

    private const val MAX_DEPTH = 15

    fun compress(root: AccessibilityNodeInfo): String {
        val result = JSONArray()
        compressNode(root, result, 0)
        return result.toString()
    }

    fun compressToList(root: AccessibilityNodeInfo): List<CompressedNode> {
        val list = mutableListOf<CompressedNode>()
        collectCompressed(root, list, 0)
        return list
    }

    private fun compressNode(node: AccessibilityNodeInfo, parent: JSONArray, depth: Int) {
        if (depth > MAX_DEPTH) return
        val obj = buildNodeJson(node)
        if (obj != null) parent.put(obj)
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { compressNode(it, parent, depth + 1) }
        }
    }

    private fun collectCompressed(node: AccessibilityNodeInfo, list: MutableList<CompressedNode>, depth: Int) {
        if (depth > MAX_DEPTH) return
        val text = node.text?.toString()?.trim() ?: ""
        val contentDesc = node.contentDescription?.toString()?.trim() ?: ""
        val hasText = text.isNotEmpty() || contentDesc.isNotEmpty()
        if (hasText || node.isClickable || node.isEditable) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            list.add(CompressedNode(
                text = if (text.isNotEmpty()) text else contentDesc,
                className = node.className?.toString()?.substringAfterLast(".") ?: "",
                clickable = node.isClickable,
                checkable = node.isCheckable,
                editable = node.isEditable,
                bounds = rect,
                viewId = node.viewIdResourceName ?: ""
            ))
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { collectCompressed(it, list, depth + 1) }
        }
    }

    private fun buildNodeJson(node: AccessibilityNodeInfo): JSONObject? {
        val text = node.text?.toString()?.trim() ?: ""
        val contentDesc = node.contentDescription?.toString()?.trim() ?: ""
        val hasText = text.isNotEmpty() || contentDesc.isNotEmpty()
        val isInteractive = node.isClickable || node.isCheckable || node.isEditable
        if (!hasText && !isInteractive) return null

        val obj = JSONObject()
        val label = if (text.isNotEmpty()) text else contentDesc
        if (label.isNotEmpty()) obj.put("t", label.take(80))
        if (node.isClickable) obj.put("clk", true)
        if (node.isCheckable) obj.put("chk", node.isChecked)
        if (node.isEditable) obj.put("edt", true)
        node.viewIdResourceName?.let { obj.put("id", it.substringAfterLast("/")) }
        return obj
    }
}

data class CompressedNode(
    val text: String,
    val className: String,
    val clickable: Boolean,
    val checkable: Boolean,
    val editable: Boolean,
    val bounds: Rect,
    val viewId: String
)