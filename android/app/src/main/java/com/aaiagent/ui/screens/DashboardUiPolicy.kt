package com.aaiagent.ui.screens

import com.aaiagent.engine.HostingMode

object DashboardUiPolicy {
    fun activePlatform(enabledPlatforms: Set<String>): String =
        enabledPlatforms.firstOrNull()?.takeIf { it.isNotBlank() } ?: "soul"

    fun connectionText(
        isHosting: Boolean,
        platform: String,
        corePermissionsReady: Boolean,
        tokenReady: Boolean
    ): String {
        val platformName = platformDisplayName(platform)
        return when {
            isHosting -> "$platformName 托管运行中"
            corePermissionsReady && tokenReady -> "$platformName 已就绪"
            corePermissionsReady -> "$platformName 待验证"
            else -> "设备权限待完善"
        }
    }

    fun hostingModeLabel(mode: HostingMode): String = when (mode) {
        HostingMode.FULL_AUTO -> "全自动"
        HostingMode.SEMI_AUTO -> "半自动"
        HostingMode.MONITOR_ONLY -> "仅记录"
    }

    fun healthyPermissionCount(
        accessibility: Boolean,
        notification: Boolean,
        batteryOptimization: Boolean,
        overlay: Boolean
    ): Int = listOf(accessibility, notification, batteryOptimization, overlay).count { it }
}
