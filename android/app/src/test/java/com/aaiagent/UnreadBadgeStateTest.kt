package com.aaiagent

import com.aaiagent.adapter.UnreadBadgeState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnreadBadgeStateTest {
    @Test
    fun `positive badge number is unread`() {
        assertTrue(UnreadBadgeState.isUnread("1", null))
        assertTrue(UnreadBadgeState.isUnread("99+", null))
    }

    @Test
    fun `empty or zero badge is not unread`() {
        assertFalse(UnreadBadgeState.isUnread("", null))
        assertFalse(UnreadBadgeState.isUnread("0", null))
        assertFalse(UnreadBadgeState.isUnread(null, null))
    }

    @Test
    fun `explicit unread description is accepted`() {
        assertTrue(UnreadBadgeState.isUnread("\u672a\u8bfb", null))
        assertTrue(UnreadBadgeState.isUnread(null, "unread message"))
    }

    @Test
    fun `visible empty unread marker is accepted`() {
        assertTrue(UnreadBadgeState.isUnread(null, null, visible = true))
    }

    @Test
    fun `tab badge text only counts when the number is above zero`() {
        // 底部聊天标签挂着 0 不算未读，否则程序会一直以为还有消息没回完。
        assertFalse(UnreadBadgeState.badgeTextMeansUnread("0"))
        assertFalse(UnreadBadgeState.badgeTextMeansUnread(" 0 "))
        assertFalse(UnreadBadgeState.badgeTextMeansUnread(""))
        assertFalse(UnreadBadgeState.badgeTextMeansUnread(null))
        assertTrue(UnreadBadgeState.badgeTextMeansUnread("1"))
        assertTrue(UnreadBadgeState.badgeTextMeansUnread("58"))
        assertTrue(UnreadBadgeState.badgeTextMeansUnread("99+"))
        assertTrue(UnreadBadgeState.badgeTextMeansUnread("\u672a\u8bfb"))
    }
}
