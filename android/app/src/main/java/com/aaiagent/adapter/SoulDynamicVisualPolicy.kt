package com.aaiagent.adapter

/**
 * Soul 动态表情有时只留下一个可点击画面，没有文字或图片说明。
 *
 * 列表预览里有具体名称时直接使用，避免重复花钱识别；只有通用名称
 * （图片、表情、动图）才把这一小块画面交给会看图的模型。
 */
object SoulDynamicVisualPolicy {
    data class Classification(
        val type: String,
        val content: String,
        val needsVision: Boolean,
    )

    fun isBareDynamicVisual(
        hasClickableView: Boolean,
        hasText: Boolean,
        hasKnownMedia: Boolean,
    ): Boolean {
        return hasClickableView && !hasText && !hasKnownMedia
    }

    fun classifyIfBare(
        expectedPreview: String,
        hasClickableView: Boolean,
        hasText: Boolean,
        knownMediaSignals: List<Boolean>,
    ): Classification? {
        if (!isBareDynamicVisual(
                hasClickableView = hasClickableView,
                hasText = hasText,
                hasKnownMedia = knownMediaSignals.any { it },
            )
        ) {
            return null
        }
        return classify(expectedPreview)
    }

    fun classify(expectedPreview: String): Classification {
        val label = SoulInteractionPreview.resolve(expectedPreview)
        if (label != null) {
            return Classification(
                type = "text",
                content = SoulInteractionPreview.modelTextFor(label),
                needsVision = false,
            )
        }
        return Classification(
            type = SoulMediaType.DYNAMIC_VISUAL,
            content = "[动态表情]",
            needsVision = true,
        )
    }
}
