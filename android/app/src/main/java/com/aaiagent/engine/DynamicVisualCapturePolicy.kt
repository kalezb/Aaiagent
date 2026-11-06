package com.aaiagent.engine

import com.aaiagent.adapter.SoulMediaType

/**
 * Soul 的动效表情要播放几秒才接近最终画面。
 *
 * 已知具体名称时不会走到这里；只有列表也只写“图片/表情/动图”的未知画面
 * 才先等待，再截取当前位置交给会看图的模型。
 */
object DynamicVisualCapturePolicy {
    const val SETTLE_BEFORE_CAPTURE_MS = 3_200L
    const val FALLBACK_MODEL_TEXT = "对方发来一个动态表情，具体画面没看清。"

    fun shouldWaitBeforeCapture(type: String): Boolean {
        return type == SoulMediaType.DYNAMIC_VISUAL
    }

    fun fallbackModelText(): String = FALLBACK_MODEL_TEXT
}
