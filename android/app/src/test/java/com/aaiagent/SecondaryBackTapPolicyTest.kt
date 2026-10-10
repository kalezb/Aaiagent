package com.aaiagent

import com.aaiagent.adapter.ChatPagePolicy
import com.aaiagent.adapter.SecondaryBackTapPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecondaryBackTapPolicyTest {
    @Test
    fun `after the first failure it switches to the safe left-edge back gesture`() {
        // 2026-10-07 用户实测：左上角“未读角标”那带能回列表，但“头像/主页”100% 进资料页。
        // 所以彻底不点节点了：第 1 次用系统返回键，第 2 次起改用左边缘返回手势（坐标碰不到头像）。
        assertFalse(SecondaryBackTapPolicy.shouldUseBackGesture(streak = 1))
        assertTrue(SecondaryBackTapPolicy.shouldUseBackGesture(streak = 2))
        assertTrue(SecondaryBackTapPolicy.shouldUseBackGesture(streak = 3))
    }

    @Test
    fun `detects the back node sitting under the unread badge`() {
        // 真机坐标：返回 [28,141][112,225]，未读角标 [28,138][160,228]
        assertTrue(
            SecondaryBackTapPolicy.overlaps(
                aLeft = 28, aTop = 141, aRight = 112, aBottom = 225,
                bLeft = 28, bTop = 138, bRight = 160, bBottom = 228,
            )
        )
    }

    @Test
    fun `keeps a clean back node usable`() {
        assertFalse(
            SecondaryBackTapPolicy.overlaps(
                aLeft = 28, aTop = 141, aRight = 112, aBottom = 225,
                bLeft = 900, bTop = 138, bRight = 1050, bBottom = 228,
            )
        )
        // 紧挨着但不相交也不算盖住
        assertFalse(
            SecondaryBackTapPolicy.overlaps(
                aLeft = 28, aTop = 141, aRight = 112, aBottom = 225,
                bLeft = 112, bTop = 141, bRight = 200, bBottom = 225,
            )
        )
    }
}


class ChatPagePolicyTest {
    @Test
    fun `a named title bar is enough even when the input box and bubbles are missing`() {
        // 2026-10-07 真机证据：在聊天页发消息的同一秒被判 chat=false ——
        // 输入框和消息项都短暂不在无障碍树里，导航于是走“未知页”，最后去点左上角进了资料页。
        assertTrue(
            ChatPagePolicy.isChatPage(
                inputBoxVisible = false,
                titleBarVisible = true,
                titleVisible = true,
                titleText = "堂堂正正的探险家",
                messageItemCount = 0,
            )
        )
    }

    @Test
    fun `the input box alone is enough`() {
        assertTrue(ChatPagePolicy.isChatPage(true, false, false, "", 0))
    }

    @Test
    fun `a page with no chat signal at all is not the chat page`() {
        assertFalse(ChatPagePolicy.isChatPage(false, false, false, "", 0))
        assertFalse(ChatPagePolicy.isChatPage(false, true, true, "   ", 0))
    }

    @Test
    fun `title bar plus message items still counts without a name`() {
        assertTrue(ChatPagePolicy.isChatPage(false, true, false, "", 3))
    }
}
