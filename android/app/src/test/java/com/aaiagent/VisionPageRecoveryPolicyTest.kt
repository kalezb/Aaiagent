package com.aaiagent

import com.aaiagent.engine.VisionPageDecision
import com.aaiagent.engine.VisionPageRecoveryPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class VisionPageRecoveryPolicyTest {
    @Test
    fun `vision label chooses a safe recovery path`() {
        assertEquals(
            VisionPageDecision.MESSAGE_LIST,
            VisionPageRecoveryPolicy.decide("MESSAGE_LIST\n这是消息列表"),
        )
        assertEquals(
            VisionPageDecision.CHAT,
            VisionPageRecoveryPolicy.decide("CHAT\n这是聊天页"),
        )
        assertEquals(
            VisionPageDecision.PROFILE,
            VisionPageRecoveryPolicy.decide("PROFILE\n这是个人资料页"),
        )
        assertEquals(
            VisionPageDecision.COMMERCE,
            VisionPageRecoveryPolicy.decide("COMMERCE\n这是支付页"),
        )
        assertEquals(
            VisionPageDecision.NOTICE,
            VisionPageRecoveryPolicy.decide("NOTICE\n这是发送失败提示"),
        )
        assertEquals(
            VisionPageDecision.OTHER,
            VisionPageRecoveryPolicy.decide("OTHER\n无法判断"),
        )
    }
}
