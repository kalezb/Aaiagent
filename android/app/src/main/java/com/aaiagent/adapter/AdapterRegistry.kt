package com.aaiagent.adapter

import android.accessibilityservice.AccessibilityService

class AdapterRegistry(service: AccessibilityService) {
    private val adapters = mapOf(
        "soul" to SoulAdapter(service),
        "qq" to QQAdapter(service),
        "immomo" to ImmomoAdapter(service),
        "lianxin" to LianxinAdapter(service)
    )

    fun get(packageName: String): PlatformAdapter? {
        val platform = when (packageName) {
            "cn.soulapp.android" -> "soul"
            "com.tencent.mobileqq" -> "qq"
            "com.immomo.momo" -> "immomo"
            "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
            else -> null
        }
        return platform?.let { adapters[it] }
    }

    fun getByPlatform(platform: String): PlatformAdapter? = adapters[platform]
    fun allPlatforms(): List<String> = adapters.keys.toList()
}
