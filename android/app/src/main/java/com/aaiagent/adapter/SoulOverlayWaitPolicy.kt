package com.aaiagent.adapter

/**
 * Decides whether Soul's animation layers must clear before the automation
 * touches the chat page.
 *
 * Soul keeps a full-screen, permanently "visible" animation host in every
 * conversation (measured: id/pb_light_interaction, bounds 0,0-1080,2252, no
 * children). Waiting for it to disappear always timed out at ~4.2s and the
 * automation proceeded anyway, which cost about 9 seconds per conversation.
 *
 * A chat page whose send input is already readable does not need that wait:
 * the overlay is an empty host, not a blocking dialog. The wait is kept for
 * the case it was written for, where the input bar is not available yet and
 * an animation really may still be covering the page.
 */
object SoulOverlayWaitPolicy {
    fun shouldWaitForClear(
        chatUsable: Boolean,
        overlayVisible: Boolean
    ): Boolean {
        if (!overlayVisible) return false
        return !chatUsable
    }
}
