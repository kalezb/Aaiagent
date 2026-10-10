package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.MessageJunkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-10-07 真机（貌若潘安的黄金圣斗士）：读屏把资料页/会话列表当成聊天读，
 * 一次灌进 32 条垃圾（26/38/关注/备注/密友/群组/我的关注/全部/一一/私聊/匹配/Souler/
 * 3小时前/10月6日 07:33/17:08），污染了该联系人 42% 的历史。
 */
class MessageJunkPolicyTest {

    private fun msg(content: String, sender: String = "other") =
        ChatMessage(sender = sender, content = content)

    @Test
    fun `looks junk shaped for the real scraped screen`() {
        // 真机原样抄下来的一屏
        val scraped = listOf(
            "26", "38", "关注", "28", "10", "20", "54", "密友", "备注", "关注我", "官方号",
            "群组", "我的关注", "全部", "17:08", "3小时前", "10月6日 07:33", "97%", "Souler"
        )
        for (text in scraped) {
            assertTrue("应判为垃圾：$text", MessageJunkPolicy.looksJunkShaped(text))
        }
    }

    @Test
    fun `real messages are not junk shaped`() {
        val real = listOf(
            "下午好呀", "国庆玩得开心吗", "回老家待了4天🤣", "就重庆周边逛了逛 你呢",
            "重庆你去的观音桥和解放碑？", "28岁的人了还这么皮", "在上班和上网之间选择了上香🙏🏼",
            "关注点不一样而已", "我全部都可以呀"
        )
        for (text in real) {
            assertFalse("不该判为垃圾：$text", MessageJunkPolicy.looksJunkShaped(text))
        }
    }

    @Test
    fun `drops the whole scraped batch but keeps the real messages in it`() {
        val batch = listOf(
            msg("下午好"),
            msg("今天过得咋样"),
            msg("关注"), msg("备注"), msg("密友"), msg("26"), msg("38"),
            msg("17:08"), msg("3小时前"),
            msg("国庆玩得开心吗")
        )
        val kept = MessageJunkPolicy.filterBatch(batch).map { it.content }
        assertEquals(listOf("下午好", "今天过得咋样", "国庆玩得开心吗"), kept)
    }

    @Test
    fun `keeps a lone number so a real age answer survives`() {
        // 他答“28”是真答案；一批里只有这一条像垃圾 → 不算误读，保留
        val batch = listOf(msg("你多大了"), msg("28"), msg("我92年的"))
        val kept = MessageJunkPolicy.filterBatch(batch).map { it.content }
        assertEquals(listOf("你多大了", "28", "我92年的"), kept)
    }

    @Test
    fun `forwarded moment from the contact is never treated as junk`() {
        // 2026-10-07 用户要求：聊天里“对方转发我的动态”要照常读给模型理解，不能被过滤。
        val forwarded = listOf(
            "[对方转发了你本人的动态]。动态作者：另一面的我（你本人）。动态正文（你本人发布）：感觉最近状态#情绪 好差啊😲😲怎么办啊",
            "[转发] 你去看我瞬间干嘛呀 那些都是随手拍的 别当真",
            "[分享] 主页 41 条瞬间"
        )
        for (text in forwarded) {
            assertTrue("转发卡片不能被判成垃圾：\$text", MessageJunkPolicy.isForwardedCard(text))
            assertFalse("转发卡片不能被过滤：\$text", MessageJunkPolicy.looksJunkShaped(text))
        }
        // 整批里混着转发卡片时，卡片要留下（真机那种一屏里既有界面垃圾又有转发）
        val batch = listOf(
            msg("关注"), msg("备注"), msg("26"),
            msg("[对方转发了你本人的动态]。动态正文：状态好差啊"),
            msg("晚上好呀")
        )
        val kept = MessageJunkPolicy.filterBatch(batch).map { it.content }
        assertEquals(listOf("[对方转发了你本人的动态]。动态正文：状态好差啊", "晚上好呀"), kept)
    }

    @Test
    fun `profile view counters are junk`() {
        for (text in listOf("主页 3 条瞬间", "瞬间 41", "主页 41 条瞬间", "为您推荐了8个瞬间")) {
            assertTrue("应判为垃圾：\$text", MessageJunkPolicy.looksJunkShaped(text))
        }
        // 但真实提到瞬间的话不能误判
        assertFalse(MessageJunkPolicy.looksJunkShaped("你瞬间空空如也"))
    }

    @Test
    fun `short batch is never treated as scraped screen`() {
        val batch = listOf(msg("26"), msg("28"))
        assertEquals(2, MessageJunkPolicy.filterBatch(batch).size)
    }
}
