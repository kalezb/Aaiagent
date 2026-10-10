package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.ChatReadFreshnessPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatReadFreshnessPolicyTest {
    private fun message(content: String) = PlatformAdapter.ChatMessage(sender = "other", content = content)

    @Test
    fun `accepts a read that ends at the list preview`() {
        val messages = listOf(message("在干嘛呢"), message("你多大了呀"))
        assertTrue(ChatReadFreshnessPolicy.matches(messages, "你多大了呀"))
    }

    @Test
    fun `accepts a truncated list preview`() {
        val messages = listOf(message("下午陪娃折腾半天 刚把他哄睡着呢"))
        assertTrue(ChatReadFreshnessPolicy.matches(messages, "下午陪娃折腾半天 刚把他哄…"))
    }

    @Test
    fun `ignores whitespace differences`() {
        val messages = listOf(message("刚把娃哄睡"))
        assertTrue(ChatReadFreshnessPolicy.matches(messages, "刚把娃 哄睡"))
    }

    @Test
    fun `rejects a stale window that ends at an older message`() {
        // 真机原样：列表预览已经是最新那句，聊天页却只读到三句之前的窗口
        val messages = listOf(message("哈哈哈"), message("有点累哟"), message("哈哈哈我说你累"))
        assertFalse(ChatReadFreshnessPolicy.matches(messages, "啥数据"))
    }

    @Test
    fun `treats an empty preview or empty read as unknown instead of stale`() {
        assertTrue(ChatReadFreshnessPolicy.matches(listOf(message("在吗")), ""))
        assertTrue(ChatReadFreshnessPolicy.matches(emptyList(), "在吗"))
    }

    @Test
    fun `does not flag a preview that only carries an emoji code`() {
        // 真机原样：预览是 [呲牙笑]，气泡里读到的却是系统提示行
        val messages = listOf(message("IP属地:重庆"))
        assertTrue(ChatReadFreshnessPolicy.matches(messages, "[呲牙笑]"))
    }

    @Test
    fun `does not flag an interaction notice on either side`() {
        val messages = listOf(message("对方发来 Soul 互动表情「弹一下」：对方弹了"))
        assertTrue(ChatReadFreshnessPolicy.matches(messages, "“未拥怎弃” 弹了弹我"))
    }

    @Test
    fun `voice placeholder in the list still matches a transcript bubble`() {
        val messages = listOf(message("对方语音转文字：你睡了吗"))

        assertTrue(ChatReadFreshnessPolicy.matches(messages, "[语音]"))
    }
}
