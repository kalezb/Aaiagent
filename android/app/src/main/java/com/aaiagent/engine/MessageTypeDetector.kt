package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo

/**
 * 消息类型识别 (补充页-消息类型识别与图片处理)
 * 对方发的消息先判断是文字/图片/表情/语音/系统消息, 分别处理
 */
object MessageTypeDetector {

    /**
     * 检测消息类型
     */
    fun detect(root: AccessibilityNodeInfo, platform: String): MessageType {
        return when (platform) {
            "soul" -> detectSoul(root)
            "qq" -> detectQQ(root)
            "immomo" -> detectMomo(root)
            "lianxin" -> detectLianxin(root)
            else -> detectGeneric(root)
        }
    }

    // ── Soul ──

    private fun detectSoul(root: AccessibilityNodeInfo): MessageType {
        val pkg = "cn.soulapp.android"
        if (hasViewId(root, "$pkg:id/item_content_root")) return MessageType.TEXT
        // TODO: 实测 Soul 的图片/表情/语音 View ID 后补充
        if (hasSystemMsg(root)) return MessageType.SYSTEM
        return MessageType.TEXT
    }

    // ── QQ (补充 §七补) ──

    private fun detectQQ(root: AccessibilityNodeInfo): MessageType {
        val pkg = "com.tencent.mobileqq"
        // 有 mj0 = 文字消息
        if (hasViewId(root, "$pkg:id/mj0")) return MessageType.TEXT
        // 有时间分隔 = 系统消息
        if (hasViewId(root, "$pkg:id/f24")) return MessageType.SYSTEM
        // TODO: 实测 QQ 图片/表情/语音 View ID 后补充
        // 没有文字特征 → 暂按图片处理 (后续接视觉模型)
        return MessageType.IMAGE
    }

    // ── 陌陌 (补充 §五) ──

    private fun detectMomo(root: AccessibilityNodeInfo): MessageType {
        val pkg = "com.immomo.momo"
        // message_tv_layouttextview = 文字消息
        if (hasViewId(root, "$pkg:id/message_tv_layouttextview")) return MessageType.TEXT
        // message_tv_noticemessage = 系统消息
        if (hasViewId(root, "$pkg:id/message_tv_noticemessage")) return MessageType.SYSTEM
        // message_gifview = 表情包/GIF
        if (hasViewId(root, "$pkg:id/message_gifview")) return MessageType.STICKER
        // 有 message_content_layout 但没有文字 → 图片
        if (hasViewId(root, "$pkg:id/message_content_layout")) return MessageType.IMAGE
        // TODO: 实测语音条 View ID 后补充
        return MessageType.UNKNOWN
    }

    // ── 连信 (占位, 待实测) ──

    private fun detectLianxin(root: AccessibilityNodeInfo): MessageType {
        // TODO: 实测连信 View ID 后补充识别逻辑
        return detectGeneric(root)
    }

    // ── 通用兜底 ──

    private fun detectGeneric(root: AccessibilityNodeInfo): MessageType {
        val textCount = countTextViews(root)
        if (textCount > 0) return MessageType.TEXT
        if (hasSystemMsg(root)) return MessageType.SYSTEM
        return MessageType.UNKNOWN
    }

    /**
     * 根据消息类型获取兜底回复 (非文字消息)
     */
    fun getFallbackReply(type: MessageType): String? {
        return when (type) {
            MessageType.IMAGE -> "你打字告诉我呗~"
            MessageType.STICKER -> "你打字告诉我呗~"
            MessageType.VOICE -> "我听不了语音呀，你打字说呗~"
            MessageType.UNKNOWN -> "你打字告诉我呗~"
            else -> null  // 文字消息不需要兜底
        }
    }

    // ── 工具方法 ──

    private fun hasViewId(node: AccessibilityNodeInfo, viewId: String): Boolean {
        return node.findAccessibilityNodeInfosByViewId(viewId).isNotEmpty()
    }

    private fun hasSystemMsg(node: AccessibilityNodeInfo): Boolean {
        return node.text?.toString()?.let { t ->
            t.contains("系统") || t.contains("通知") || t.contains("提示")
        } == true
    }

    private fun countTextViews(node: AccessibilityNodeInfo): Int {
        var count = 0
        if (node.className?.toString()?.contains("TextView") == true) {
            val t = node.text?.toString()?.trim() ?: ""
            if (t.isNotEmpty()) count++
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { count += countTextViews(it) }
        }
        return count
    }
}

/**
 * 消息类型枚举
 */
enum class MessageType {
    /** 文字消息 — 正常 LLM 流程 */
    TEXT,
    /** 图片消息 — 截图给视觉模型 (暂回兜底文案) */
    IMAGE,
    /** 表情包 — 同图片处理 */
    STICKER,
    /** 语音消息 — 等 ASR (暂回兜底文案) */
    VOICE,
    /** 系统消息 — 直接跳过 */
    SYSTEM,
    /** 无法识别 — 回兜底文案 */
    UNKNOWN
}