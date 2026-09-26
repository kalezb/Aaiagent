package com.aaiagent.adapter

object SoulInteractionKind {
    const val LIGHT = "light"
    const val STATIC = "static"
    const val EXPRESSION = "expression"

    fun resolve(
        hasLightInteraction: Boolean,
        hasBareStaticSticker: Boolean,
        hasExpressionImage: Boolean
    ): String? {
        return when {
            hasLightInteraction -> LIGHT
            hasBareStaticSticker -> STATIC
            hasExpressionImage -> EXPRESSION
            else -> null
        }
    }
}
