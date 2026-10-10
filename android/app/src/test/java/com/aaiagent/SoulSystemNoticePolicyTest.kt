package com.aaiagent

import com.aaiagent.adapter.SoulSystemNoticePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulSystemNoticePolicyTest {
    @Test
    fun noticesAreNotMessages() {
        val notices = listOf(
            "IP属地:重庆",
            "对方正在输入...",
            "你撤回了一条消息",
            "系统通知：你的账号已通过审核",
            "官方消息：本周活动开始啦",
            "TA刚刚看过你的主页",
            "匹配成功，打个招呼吧",
            "安全提醒：谨防诈骗",
        )
        for (text in notices) assertTrue(text, SoulSystemNoticePolicy.isNotice(text))
    }

    @Test
    fun realMessagesStayReadable() {
        val messages = listOf(
            "还没休息呀",
            "今天给你带了个礼物 见面给你",
            "我把我那个杯子送你吧",
            "你在干嘛呢",
        )
        for (text in messages) assertFalse(text, SoulSystemNoticePolicy.isNotice(text))
    }
}
