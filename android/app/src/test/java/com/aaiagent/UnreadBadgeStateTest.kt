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
}
