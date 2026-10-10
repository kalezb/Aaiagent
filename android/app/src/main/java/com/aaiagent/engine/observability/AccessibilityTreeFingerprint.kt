package com.aaiagent.engine.observability

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import java.security.MessageDigest

object AccessibilityTreeFingerprint {
    private const val MAX_NODES = 140

    fun from(root: AccessibilityNodeInfo?): String {
        if (root == null) return ""
        val builder = StringBuilder(2_048)
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var count = 0
        while (queue.isNotEmpty() && count < MAX_NODES) {
            val node = queue.removeFirst()
            count += 1
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            builder.append(node.className?.toString().orEmpty())
                .append('|')
                .append(node.viewIdResourceName.orEmpty())
                .append('|')
                .append(node.text?.toString()?.length ?: 0)
                .append('|')
                .append(bounds.left / 8)
                .append(',')
                .append(bounds.top / 8)
                .append(',')
                .append(bounds.right / 8)
                .append(',')
                .append(bounds.bottom / 8)
                .append(';')
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::addLast)
            }
        }
        return sha256(builder.toString())
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}
