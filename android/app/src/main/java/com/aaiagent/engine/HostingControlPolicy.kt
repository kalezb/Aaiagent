package com.aaiagent.engine

object HostingControlPolicy {
    fun startFailure(hasToken: Boolean, accessibilityReady: Boolean): String? = when {
        !hasToken -> "请先验证设备钥匙"
        !accessibilityReady -> "无障碍服务未启动"
        else -> null
    }
}
