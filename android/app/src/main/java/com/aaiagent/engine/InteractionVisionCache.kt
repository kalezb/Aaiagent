package com.aaiagent.engine

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Caches vision descriptions for interactive stickers that the local template
 * matcher cannot identify. The stable message identity is used as the key, so
 * the same item keeps its meaning across repeated accessibility reads.
 */
object InteractionVisionCache {
    private const val PREFS_NAME = "interaction_vision_cache"
    private const val PREFIX = "interaction:"
    private val memory = ConcurrentHashMap<String, String>()

    @Volatile
    private var preferences: SharedPreferences? = null

    fun initialize(context: Context) {
        if (preferences == null) {
            preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    fun get(identityKey: String): String? {
        val key = cacheKey(identityKey)
        if (key.isEmpty()) return null
        memory[key]?.let { return it }
        val stored = preferences?.getString(PREFIX + key, null)?.trim().orEmpty()
        if (stored.isEmpty()) return null
        memory[key] = stored
        return stored
    }

    fun put(identityKey: String, description: String) {
        val key = cacheKey(identityKey)
        val value = description.trim()
        if (key.isEmpty() || value.isEmpty()) return
        memory[key] = value
        preferences?.edit()?.putString(PREFIX + key, value)?.apply()
    }

    fun cacheKey(identityKey: String): String {
        val source = identityKey.trim()
        if (source.isEmpty()) return ""
        return MessageDigest.getInstance("SHA-256")
            .digest(source.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    internal fun clearMemoryForTests() {
        memory.clear()
        preferences = null
    }
}
