package com.aaiagent.engine

/**
 * 记住"我发出去的语音到底说了什么"。
 *
 * **为什么需要**：Soul 的语音气泡在无障碍树里只有「[语音]」两个字。不带内容的话，
 * 大模型看不到自己刚才说了什么，就会重复自己刚说过的话、或者接不上对方的话。
 * 真机 2026-10-06 观察到：我方语音在上下文里只存成 `[语音]`。
 *
 * **为什么不按消息编号存**：编号里带内容（见 [com.aaiagent.adapter.SoulMessageIdentity.key]），
 * 内容一改编号就变，同一条语音会被当成两条、上下文里重复出现；而且没有时间戳的两条语音
 * 编号本来就会撞车。所以改成按「**录音时长 + 先后顺序**」配对 ——
 * 时长是气泡上稳定显示的数字，而发的时候我们自己读的也是同一个数字。
 */
object SelfVoiceMemory {

    data class Entry(
        val durationSeconds: Int,
        val text: String,
        val sentAtMillis: Long
    )

    /** 每个会话最多记这么多条，防止长跑时无限增长。 */
    private const val MAX_PER_CONVERSATION = 30

    private val byConversation = mutableMapOf<String, MutableList<Entry>>()

    /** 记下"我发了一条 [durationSeconds] 秒的语音，内容是 [text]"。 */
    @Synchronized
    fun remember(
        conversationKey: String,
        durationSeconds: Int,
        text: String,
        sentAtMillis: Long
    ) {
        val key = conversationKey.trim()
        val spoken = text.trim()
        if (key.isEmpty() || durationSeconds <= 0 || spoken.isEmpty()) return
        val list = byConversation.getOrPut(key) { mutableListOf() }
        list.add(Entry(durationSeconds, spoken, sentAtMillis))
        while (list.size > MAX_PER_CONVERSATION) list.removeAt(0)
    }

    @Synchronized
    fun forget(conversationKey: String) {
        byConversation.remove(conversationKey.trim())
    }

    @Synchronized
    fun clear() {
        byConversation.clear()
    }

    @Synchronized
    fun size(conversationKey: String): Int =
        byConversation[conversationKey.trim()]?.size ?: 0

    /**
     * 按聊天顺序，给一批"自己发的语音"补上当时说的话。
     *
     * [durationsSeconds] 是本次读到的自己语音气泡的时长（按聊天顺序）。
     * **时长对不上的位置返回 null** —— 宁可显示「[语音]」，也不能张冠李戴把别的话套上去。
     *
     * 配的顺序是**从最新一条往回配**：只有 AiaAgent 自己发出去的语音才记得住内容，
     * 手动发的记不住。从最新往回配，记不住的（通常是比较旧的）就自然留在「[语音]」，
     * 不会出现"新说的话被套到旧语音头上"（真机 2026-10-06 07:09 实测踩到过）。
     * 两边数量一样时，倒着配和正着配结果完全相同。
     *
     * 本方法是幂等的：同一批输入重复调用结果完全一致（"已用"只在本轮内部标记）。
     * 这点很重要 —— 每轮读消息都会重新走一遍，不能因为"用过了"就配对失败。
     */
    @Synchronized
    fun match(conversationKey: String, durationsSeconds: List<Int>): List<String?> {
        val entries = byConversation[conversationKey.trim()].orEmpty()
        val result = arrayOfNulls<String>(durationsSeconds.size)
        if (entries.isEmpty()) return result.toList()
        val used = BooleanArray(entries.size)
        for (i in durationsSeconds.indices.reversed()) {
            val seconds = durationsSeconds[i]
            if (seconds <= 0) continue
            val hit = entries.indices.lastOrNull { !used[it] && entries[it].durationSeconds == seconds }
            if (hit != null) {
                used[hit] = true
                result[i] = entries[hit].text
            }
        }
        return result.toList()
    }
}
