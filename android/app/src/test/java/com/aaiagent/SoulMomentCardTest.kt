package com.aaiagent

import com.aaiagent.adapter.SoulMomentCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulMomentCardTest {

    @Test
    fun `读出作者和正文`() {
        assertEquals(
            "[对方转发了动态]。动态作者：另一面的我。动态正文：今天穿了双新买的高跟鞋",
            SoulMomentCard.format(
                author = "另一面的我",
                content = "今天穿了双新买的高跟鞋",
                forwardedByOther = true
            )
        )
    }

    @Test
    fun `只有作者没有正文时不留空档`() {
        assertEquals(
            "[对方转发了动态]。动态作者：另一面的我",
            SoulMomentCard.format("另一面的我", null, forwardedByOther = true)
        )
    }

    @Test
    fun `作者和正文都读不到时只报转发了动态`() {
        assertEquals(
            "[对方转发了动态]",
            SoulMomentCard.format("  ", "", forwardedByOther = true)
        )
    }

    @Test
    fun `不擅自断言是本人发的，只如实报作者名`() {
        // 转发过来的可能是对方自己的或第三个人的动态，光看卡片判断不出来，
        // 所以文案里不能出现"你本人"这种没根据的断言。
        val text = SoulMomentCard.format("随便谁", "随便一句话", forwardedByOther = true)
        assertTrue(text.isNotBlank())
        assertEquals(false, text.contains("你本人"))
    }

    @Test
    fun `配图描述拼在卡片文字后面`() {
        val text = SoulMomentCard.withImageDescription(
            "[对方转发了动态]。动态正文：新鞋到了",
            "一个女生站在镜子前，脚上是米白色尖头高跟鞋"
        )
        assertTrue(text.startsWith("[对方转发了动态]。动态正文：新鞋到了。动态配图（客观识别）："))
        assertTrue(text.contains("米白色尖头高跟鞋"))
        assertTrue(text.contains("不能改猜成其他人或无关物品"))
    }

    @Test
    fun `截图或识别失败时原样返回卡片文字，不能变空`() {
        val cardText = "[对方转发了动态]。动态正文：新鞋到了"
        assertEquals(cardText, SoulMomentCard.withImageDescription(cardText, null))
        assertEquals(cardText, SoulMomentCard.withImageDescription(cardText, "   "))
        // 卡片文字本身也读不到时，至少留下兜底标记，绝不给模型一条空消息。
        assertEquals(SoulMomentCard.FALLBACK, SoulMomentCard.withImageDescription("", null))
    }
}