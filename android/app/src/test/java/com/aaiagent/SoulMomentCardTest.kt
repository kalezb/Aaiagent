package com.aaiagent

import com.aaiagent.adapter.SoulMomentCard
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMomentCardTest {
    @Test
    fun `formats forwarded moment as content published by the current persona`() {
        assertEquals(
            "[对方转发了你本人的动态]。动态作者：另一面的我（你本人）。动态正文（你本人发布）：今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了",
            SoulMomentCard.format(
                author = "另一面的我",
                content = "今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了",
                forwardedByOther = true
            )
        )
    }

    @Test
    fun `keeps shell and author when only part of the card is visible`() {
        assertEquals(
            "[对方转发了你本人的动态]",
            SoulMomentCard.format(null, null, forwardedByOther = true)
        )
        assertEquals(
            "[对方转发了你本人的动态]。动态作者：另一面的我（你本人）",
            SoulMomentCard.format("另一面的我", null, forwardedByOther = true)
        )
    }

    @Test
    fun `does not claim ownership when the card was not forwarded by the other person`() {
        assertEquals(
            "[转发了动态]。动态正文：测试动态",
            SoulMomentCard.format(null, "测试动态", forwardedByOther = false)
        )
    }
}
