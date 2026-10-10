package com.aaiagent.ui.screens

import com.aaiagent.engine.HostingMode

enum class ModelLineHealthState {
    UNKNOWN,
    CHECKING,
    CONNECTED,
    FAILED,
}

enum class ConnectionTone {
    GREEN,
    YELLOW,
    RED,
}

object DashboardUiPolicy {
    fun activePlatform(enabledPlatforms: Set<String>): String =
        enabledPlatforms.firstOrNull()?.takeIf { it.isNotBlank() } ?: "soul"

    fun connectionText(
        isHosting: Boolean,
        platform: String,
        corePermissionsReady: Boolean,
        tokenReady: Boolean,
        lineHealth: ModelLineHealthState = ModelLineHealthState.UNKNOWN,
        lineName: String = ""
    ): String {
        val platformName = platformDisplayName(platform)
        val lineLabel = lineName.ifBlank { "线路" }
        return when {
            !corePermissionsReady -> "设备权限待完善"
            !tokenReady -> "$platformName 待验证"
            lineHealth == ModelLineHealthState.FAILED -> "$lineLabel 连接失败"
            lineHealth == ModelLineHealthState.CHECKING -> "正在检测 $lineLabel"
            lineHealth == ModelLineHealthState.UNKNOWN -> "$lineLabel 待检测"
            isHosting -> "$platformName 托管运行中"
            else -> "$platformName 已就绪"
        }
    }

    fun connectionTone(
        corePermissionsReady: Boolean,
        tokenReady: Boolean,
        lineHealth: ModelLineHealthState
    ): ConnectionTone = when {
        !corePermissionsReady -> ConnectionTone.YELLOW
        !tokenReady || lineHealth == ModelLineHealthState.FAILED -> ConnectionTone.RED
        lineHealth == ModelLineHealthState.CONNECTED -> ConnectionTone.GREEN
        else -> ConnectionTone.YELLOW
    }

    fun selectedLineHealth(
        lineA: Boolean,
        healthA: ModelLineHealthState,
        healthB: ModelLineHealthState
    ): ModelLineHealthState = if (lineA) healthA else healthB

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
