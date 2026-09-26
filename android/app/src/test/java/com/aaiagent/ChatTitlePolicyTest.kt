package com.aaiagent

import com.aaiagent.engine.ChatTitlePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatTitlePolicyTest {
    @Test
    fun `keeps normal contact names`() {
        assertEquals("期待下一步的我们", ChatTitlePolicy.sanitize("期待下一步的我们"))
        assertEquals("见仁见智", ChatTitlePolicy.sanitize(" 见仁见智 "))
    }

    @Test
    fun `rejects action labels that are not contact names`() {
        assertNull(ChatTitlePolicy.sanitize("关注后可邀请通话"))
        assertNull(ChatTitlePolicy.sanitize("发送"))
        assertNull(ChatTitlePolicy.sanitize("取消"))
        assertNull(ChatTitlePolicy.sanitize("99"))
    }
}
