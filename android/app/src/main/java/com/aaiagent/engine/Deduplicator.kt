package com.aaiagent.engine

import java.security.MessageDigest

object Deduplicator {
    private val seen = mutableMapOf<String, Long>()

    fun fingerprint(platform: String, contactId: String, content: String): String {
        val input = platform + contactId + content
        val bytes = MessageDigest.getInstance("MD5").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun isSeenRecent(fp: String, windowMs: Long): Boolean {
        val now = System.currentTimeMillis()
        val lastSeen = seen[fp]
        if (lastSeen != null && now - lastSeen < windowMs) return true
        return false
    }

    fun markSeen(fp: String) {
        seen[fp] = System.currentTimeMillis()
        // 清理过期条目
        val cutoff = System.currentTimeMillis() - 10 * 60 * 1000
        seen.entries.removeAll { it.value < cutoff }
    }
}
