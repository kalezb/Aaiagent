package com.aaiagent.ui.screens

import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

fun checkPermissionStatus(context: Context): PermissionStatus {
    val accessibility = runCatching {
        Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains(context.packageName) == true
    }.getOrDefault(false)

    val notification = runCatching {
        Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        )?.contains(context.packageName) == true
    }.getOrDefault(false)

    val batteryOptimization = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val manager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        manager.isIgnoringBatteryOptimizations(context.packageName)
    } else {
        true
    }

    val overlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(context)
    } else {
        true
    }

    return PermissionStatus(accessibility, notification, batteryOptimization, overlay)
}

fun platformDisplayName(platform: String): String = when (platform) {
    "soul" -> "Soul"
    "qq" -> "QQ"
    "douban" -> "豆瓣"
    "lianxin" -> "连信"
    else -> platform
}
