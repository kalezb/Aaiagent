package com.aaiagent.adapter

enum class SoulNavigationAction {
    NONE,
    TAP_MESSAGE_TAB,
    TAP_SPLASH_SKIP,
    BACK,
    WAIT
}

object SoulNavigationPolicy {
    fun decide(
        isInMessageList: Boolean,
        hasMessageTab: Boolean,
        hasSplashSkip: Boolean,
        isInChat: Boolean
    ): SoulNavigationAction = when {
        isInMessageList -> SoulNavigationAction.NONE
        hasSplashSkip -> SoulNavigationAction.TAP_SPLASH_SKIP
        hasMessageTab -> SoulNavigationAction.TAP_MESSAGE_TAB
        isInChat -> SoulNavigationAction.BACK
        else -> SoulNavigationAction.WAIT
    }
}
