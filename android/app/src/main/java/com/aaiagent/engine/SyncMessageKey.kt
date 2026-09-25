package com.aaiagent.engine

object SyncMessageKey {
    fun build(
        platform: String,
        contactId: String,
        role: String,
        content: String,
        sequence: Long
    ): String {
        val fingerprint = listOf(role, content.trim(), sequence).joinToString("\u001f")
        return "sync:${platform.trim()}:${contactId.trim()}:${fnv1a(fingerprint)}".take(220)
    }

    private fun fnv1a(value: String): String {
        var hash = 2166136261u
        value.forEach { character ->
            hash = hash xor character.code.toUInt()
            hash *= 16777619u
        }
        return hash.toString(36)
    }
}
