package com.aaiagent.adapter

object SoulInteractionKind {
    const val LIGHT = "light"
    const val STATIC = "static"

    fun resolve(
        hasLightInteraction: Boolean,
        hasBareStaticSticker: Boolean
    ): String? {
        return when {
            hasLightInteraction -> LIGHT
            hasBareStaticSticker -> STATIC
            else -> null
        }
    }
}
