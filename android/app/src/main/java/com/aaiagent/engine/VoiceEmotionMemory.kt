package com.aaiagent.engine

/**
 * 每个会话"上一轮的情绪状态"。
 *
 * 情绪要连成一条轨迹，就得把上一轮的状态带到下一轮 —— 这正是方案文档里
 * "跨轮情绪记忆"的落地点。后端拿它来判断"这次该不该翻脸"、
 * "要不要接着上一轮的委屈往下走"。
 *
 * 为什么放内存就够：状态本身带时间戳，后端超过两小时没人说话会把它衰减回中性。
 * 所以进程重启丢掉也无所谓，最多是情绪断一次，不会留下过期状态。
 */
object VoiceEmotionMemory {

    /** 最多记多少个会话。多了按最久没用过的淘汰。 */
    private const val MAX_CONVERSATIONS = 50

    private val states = object : LinkedHashMap<String, String>(16, 0.75f, true) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, String>?
        ): Boolean = size > MAX_CONVERSATIONS
    }

    @Synchronized
    fun previous(conversationKey: String): String? {
        val key = conversationKey.trim()
        if (key.isEmpty()) return null
        return states[key]
    }

    @Synchronized
    fun remember(conversationKey: String, stateJson: String?) {
        val key = conversationKey.trim()
        val value = stateJson?.trim().orEmpty()
        if (key.isEmpty() || value.isEmpty()) return
        states[key] = value
    }

    @Synchronized
    fun forget(conversationKey: String) {
        states.remove(conversationKey.trim())
    }

    @Synchronized
    fun clear() {
        states.clear()
    }

    @Synchronized
    fun size(): Int = states.size
}
