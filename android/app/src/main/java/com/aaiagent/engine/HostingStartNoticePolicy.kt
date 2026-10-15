package com.aaiagent.engine

object HostingStartNoticePolicy {
    fun notice(
        whitelist: List<String>,
        blacklist: List<String>,
    ): String {
        val white = whitelist.map(String::trim).filter(String::isNotEmpty)
        val black = blacklist.map(String::trim).filter(String::isNotEmpty)
        if (white.isNotEmpty()) {
            return "提醒：当前有白名单${white.size}位，AI托管只会回复白名单联系人"
        }
        if (black.isNotEmpty()) {
            return "提醒：当前有黑名单${black.size}位，这些联系人会被跳过"
        }
        return ""
    }
}
