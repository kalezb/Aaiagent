package com.aaiagent.adapter

object SoulExchangePolicy {
    const val EXCHANGE_LABEL = "以图换图"
    const val PRIVACY_DISABLED_LABEL = "隐私保护"
    const val PRIVACY_ENABLED_LABEL = "禁止下载"
    const val PROTECTED_TAG = "对方无法下载/截屏"

    fun isExchangeLabel(text: CharSequence?): Boolean {
        return normalize(text).contains(EXCHANGE_LABEL)
    }

    fun isPrivacyEnabled(text: CharSequence?, checked: Boolean): Boolean {
        return checked && normalize(text).contains(PRIVACY_ENABLED_LABEL)
    }

    fun isProtectedMessage(status: CharSequence?, tag: CharSequence?): Boolean {
        val normalizedStatus = normalize(status)
        val normalizedTag = normalize(tag)
        return normalizedStatus.contains(PRIVACY_DISABLED_LABEL) &&
            normalizedTag.contains("对方无法下载")
    }

    fun fallbackSubmitPoint(screenWidth: Int, screenHeight: Int): ExchangePoint {
        val x = (screenWidth * SUBMIT_X_RATIO).toInt().coerceIn(1, screenWidth - 1)
        val y = (screenHeight * SUBMIT_Y_RATIO).toInt().coerceIn(1, screenHeight - 1)
        return ExchangePoint(x, y)
    }

    private fun normalize(text: CharSequence?): String {
        return text?.toString().orEmpty().replace(Regex("\\s+"), "")
    }

    data class ExchangePoint(val x: Int, val y: Int)

    private const val SUBMIT_X_RATIO = 0.854f
    private const val SUBMIT_Y_RATIO = 0.957f
}
