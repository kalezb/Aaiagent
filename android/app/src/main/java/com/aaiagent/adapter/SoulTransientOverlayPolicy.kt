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
    )

    private val BLOCKING_OVERLAY_VIEW_IDS = setOf(
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
    )

    fun isTransientViewId(viewId: String?): Boolean {
        return localViewId(viewId) in TRANSIENT_VIEW_IDS
    }

    fun shouldWaitForClear(viewId: String?): Boolean {
        return localViewId(viewId) in BLOCKING_OVERLAY_VIEW_IDS
    }

    private fun localViewId(viewId: String?): String {
        return viewId
            ?.substringAfterLast('/')
            ?.trim()
            .orEmpty()
    }
}
