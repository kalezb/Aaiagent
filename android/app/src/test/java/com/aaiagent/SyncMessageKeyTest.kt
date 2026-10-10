package com.aaiagent

import com.aaiagent.engine.SyncMessageKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SyncMessageKeyTest {
    @Test
    fun sameMessageGetsTheSameKeyAcrossSyncs() {
        // 2026-10-06 稀奇：同一条消息同步两次生成了两个 key，历史里出现重复。
        val first = SyncMessageKey.build("soul", "稀奇", "assistant", "我也还没呢 正准备洗洗睡了", 12)
        val second = SyncMessageKey.build("soul", "稀奇", "assistant", "我也还没呢 正准备洗洗睡了", 37)
        assertEquals(first, second)
    }

    @Test
    fun driftingRelativeTimeLabelMustNotCreateADuplicate() {
        // 2026-10-07 真机（不期而遇 / 卡卡罗特）：00:16~00:22 的 6 条消息，在 00:51:30
        // 这一秒里整段又入库了一遍，每条都拿到新 key，模型于是以为话题在原地打转、
        // 回复开始重复追问。
        //
        // 这次漂移的是 createdAt：它由页面上的**相对**时间标签（“刚刚”“5分钟前”）
        // 解析而来，隔一段时间重读同一句话会算出不同的绝对时间。
        // 跟 2026-10-06 的 sequence 是同一个坑换了个入口。
        //
        // 所以这里断言的是：时间锚点变了也必须拿到同一个 key。
        // 旧版本有一条 "differentContentOrTimeStillDiffers" 断言时间不同 key 必须不同，
        // 那是基于“解析出的时间对同一条消息是稳定的”这个假设 —— 真机证明假设不成立。
        val first = SyncMessageKey.build(
            platform = "soul",
            contactId = "不期而遇",
            role = "user",
            content = "我感觉你在用AI聊天",
            sequence = 10,
            createdAt = 1_791_302_199L,
        )
        val second = SyncMessageKey.build(
            platform = "soul",
            contactId = "不期而遇",
            role = "user",
            content = "我感觉你在用AI聊天",
            sequence = 87,
            createdAt = 1_791_304_290L,
        )
        assertEquals(first, second)
    }

    @Test
    fun stableKeyStillSeparatesRepeatedIdenticalLines() {
        // 稳定的锚点（角色+类型+内容）照旧能区分“同一句话说了两遍”。
        val a = SyncMessageKey.build("soul", "不期而遇", "user", "哈哈哈", 1, stableKey = "user|text|哈哈哈#1")
        val b = SyncMessageKey.build("soul", "不期而遇", "user", "哈哈哈", 1, stableKey = "user|text|哈哈哈#2")
        assertNotEquals(a, b)
    }

    @Test
    fun differentContentOrRoleStillDiffers() {
        val a = SyncMessageKey.build("soul", "稀奇", "user", "睡啦", 1)
        val b = SyncMessageKey.build("soul", "稀奇", "user", "哈哈", 1)
        assertNotEquals(a, b)
        val c = SyncMessageKey.build("soul", "稀奇", "assistant", "睡啦", 1)
        assertNotEquals(a, c)
        val d = SyncMessageKey.build("soul", "另一个联系人", "user", "睡啦", 1)
        assertNotEquals(a, d)
    }

    @Test
    fun voiceTranscriptKeepsTheSameMessageKey() {
        val beforeTranscript = SyncMessageKey.build(
            platform = "soul",
            contactId = "这不雷哥那",
            role = "user",
            content = "[语音]",
            sequence = 1,
            stableKey = "soul\u001fother\u001fvoice\u001f[语音]",
        )
        val afterTranscript = SyncMessageKey.build(
            platform = "soul",
            contactId = "这不雷哥那",
            role = "user",
            content = "对方语音转文字：你睡了吗",
            sequence = 2,
            stableKey = "soul\u001fother\u001fvoice\u001f[语音]",
        )

        assertEquals(beforeTranscript, afterTranscript)
    }
}
