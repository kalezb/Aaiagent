package com.aaiagent.engine

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * 互动表情的视觉描述缓存。
 *
 * 2026-10-11 真机事故：所有互动表情的 identityKey 都是
 * `soul\x1Fother\x1Finteraction\x1F[Soul互动表情]`，一个太阳表情的视觉描述
 * 因此污染了所有联系人的所有互动表情，真机出现“夜深了”被回成“发个太阳”。
 *
 * 这类通用身份无法区分具体图案，必须禁止缓存；本地识别失败时每次都重新看。
 * 这里保留清理旧缓存的动作，但不给通用互动表情写新缓存。
 */
object InteractionVisionCache {
    private const val PREFS_NAME = "interaction_vision_cache"
    private const val PREFIX = "interaction:"
    private const val LEGACY_CLEARED_KEY = "legacy_generic_interaction_cache_cleared"
    private val memory = ConcurrentHashMap<String, String>()

    @Volatile
    private var preferences: SharedPreferences? = null

    fun initialize(context: Context) {
        if (preferences == null) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            preferences = prefs
            clearLegacyCache(prefs)
        }
    }

    fun get(identityKey: String): String? {
        if (!isCacheableIdentity(identityKey)) return null
        val key = cacheKey(identityKey)
        if (key.isEmpty()) return null
        memory[key]?.let { return it }
        val stored = preferences?.getString(PREFIX + key, null)?.trim().orEmpty()
        if (stored.isEmpty()) return null
        memory[key] = stored
        return stored
    }

    fun put(identityKey: String, description: String) {
        if (!isCacheableIdentity(identityKey)) return
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

    fun isCacheableIdentity(identityKey: String): Boolean {
        val source = identityKey.trim()
        if (source.isEmpty()) return false
        // 通用互动表情只说明“这是一个互动”，不包含具体图案，不能作为缓存键。
        return !(source.contains("interaction") && source.contains("[Soul互动表情]"))
    }

    private fun clearLegacyCache(prefs: SharedPreferences) {
        if (prefs.getBoolean(LEGACY_CLEARED_KEY, false)) return
        val editor = prefs.edit()
        prefs.all.keys
            .filter { key -> key.startsWith(PREFIX) }
            .forEach(editor::remove)
        editor.putBoolean(LEGACY_CLEARED_KEY, true).apply()
    }

    internal fun clearMemoryForTests() {
        memory.clear()
        preferences = null
    }
}
