package com.aaiagent.adapter

/** Decorative Soul overlays that must never be treated as chat content. */
object SoulTransientOverlayPolicy {
    private val TRANSIENT_VIEW_IDS = setOf(
        "fl_chat_card_content",
        "pb_light_interaction",
        "la_light_interaction",
        "lav_interaction",
        "lightAnimView",
        "lightLottie",
        "gift_fly_animation",
        "giftStormView",
        "giftLottie",
        "lottieGiftView",
        "lot_big_heart",
        "heartLottie",
        "lottie_heart",
        // SVGA 动画层
        "svga_view",
        "svgaView",
        "svg_view",
        "svga_player",
        "svgaPlayer",
        "svga_animation",
        "svgaAnimation",
        "svgaImageView",
        "svga_image_view",
        "chat_svga_view",
        "fl_svga_container",
        "svga_container",
        "svgaGiftView",
        "gift_svga",
        "gift_svga_view",
        "svga_chat_gift",
        // Lottie 动效层
        "lottie_view",
        "lottieView",
        "lav_view",
        "lav_animation",
        "lottie_animation",
        "animation_view",
        "anim_view",
        "chat_lottie_view",
        "lottie_container",
        "fl_lottie_container",
        "lottie_anim",
        // 全屏动效与动态表情容器
        "full_screen_animation",
        "full_screen_anim_container",
        "fullscreen_anim_view",
        "full_screen_lottie",
        "chat_anim_container",
        "anim_container",
        "animation_container",
        "dynamic_expression_view",
        "fl_dynamic_expression",
        "dynamic_sticker_view",
        "rl_dynamic_expression",
        "interaction_anim_container",
        "fl_interaction_anim",
        "gift_anim_container",
        "gift_animation_view",
        "fly_gift_view",
        "rl_animation",
    )

    private val BLOCKING_OVERLAY_VIEW_IDS = TRANSIENT_VIEW_IDS - "fl_chat_card_content"

    fun isTransientViewId(viewId: String?): Boolean {
        val id = localViewId(viewId)
        if (id.isEmpty()) return false
        return id in TRANSIENT_VIEW_IDS || matchesAnimationPattern(id)
    }

    fun shouldWaitForClear(viewId: String?): Boolean {
        val id = localViewId(viewId)
        if (id.isEmpty() || id == "fl_chat_card_content") return false
        return id in BLOCKING_OVERLAY_VIEW_IDS || matchesAnimationPattern(id)
    }

    private fun matchesAnimationPattern(id: String): Boolean {
        if (id.isEmpty()) return false
        val lower = id.lowercase()
        return lower.contains("svga") ||
            lower.contains("lottie") ||
            lower.endsWith("_anim") ||
            lower.endsWith("_animation")
    }

    private fun localViewId(viewId: String?): String {
        return viewId
            ?.substringAfterLast('/')
            ?.trim()
            .orEmpty()
    }
}
