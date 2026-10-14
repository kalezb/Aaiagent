package com.aaiagent.engine

internal class ConversationContextStore(
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val contexts = mutableMapOf<String, ConversationContext>()

    @Synchronized
    fun getOrCreate(platform: String, contactId: String): ConversationContext {
        val nowMs = now()
        val context = contexts.getOrPut("$platform:$contactId") {
            ConversationContext(platform, contactId, firstMessageAt = nowMs)
        }
        context.touch(nowMs)
        prune(nowMs)
        return context
    }

    @Synchronized
    fun all(): List<ConversationContext> = contexts.values.toList()

    @Synchronized
    internal fun size(): Int = contexts.size

    /**
     * Keeps the in-memory conversation table bounded. Conversations that still
     * owe a reply are always kept.
     */
    private fun prune(nowMs: Long) {
        if (contexts.size <= ConversationContextRetentionPolicy.MAX_CONTEXTS) return
        val entries = contexts.map { (key, context) ->
            ConversationContextRetentionPolicy.Entry(
                key = key,
                lastTouchedAtMs = context.lastTouchedAtMs,
                hasPendingWork = context.hasPendingWork(),
            )
        }
        val evicted = ConversationContextRetentionPolicy.keysToEvict(entries, nowMs)
        if (evicted.isEmpty()) return
        evicted.forEach { key -> contexts.remove(key) }
        runCatching {
            android.util.Log.d(
                "AIA",
                "conversation contexts evicted count=${evicted.size} remaining=${contexts.size}",
            )
        }
    }
}
