package com.aaiagent.engine

object HostingControlPolicy {
    fun startFailure(
        hasToken: Boolean,
        tokenVerified: Boolean = hasToken,
        accessibilityReady: Boolean
    ): String? = when {
        !hasToken -> "请先验证设备密钥"
        !tokenVerified -> "设备密钥未通过后端验证"
        !accessibilityReady -> "无障碍服务未启动"
        else -> null
    }
}
