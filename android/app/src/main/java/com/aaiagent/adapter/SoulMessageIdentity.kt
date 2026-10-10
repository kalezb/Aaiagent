package com.aaiagent.adapter

/**
 * 一条消息的“身份”。
 *
 * 2026-10-07（方案 B 第二层）：身份里**不能带时间**。
 * Soul 给同一条消息的时间标签会变（“02:47” → “昨天 02:47” → “3分钟前”），
 * 以前身份里带着 millis/clock，标签一变整条消息就变成“新消息”——
 * 真机上表现为：旧消息被当成刚发来的，重复回复、顺序错乱。
 *
 * 现在只按“谁发的 + 类型 + 内容”认身份；时间只用来给模型看，不参与身份。
 * 代价：同一人连发两条一模一样的话（如“哈哈”“哈哈”）会被当成一条，
 * 这种极少见，而且比“旧消息被当新的”危害小得多。
 */
object SoulMessageIdentity {
    private const val SEPARATOR = "\u001F"

    fun key(
        sender: String,
        type: String,
        content: String,
    ): String {
        val contentAnchor = content.trim().replace(Regex("\\s+"), " ")
        return listOf("soul", sender, type, contentAnchor).joinToString(SEPARATOR)
    }

    /** 界面上到底有没有写出时间（写了才算“他发送的时间”，没写就是我们读到的）。 */
    fun hasExplicitTime(timestampText: String, timestampMillis: Long?): Boolean {
        if (timestampMillis != null && timestampMillis > 0L) return true
        return timestampText.trim().isNotEmpty()
    }
}
