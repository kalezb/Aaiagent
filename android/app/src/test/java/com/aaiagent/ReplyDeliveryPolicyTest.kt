package com.aaiagent

import com.aaiagent.engine.ReplyDeliveryPolicy
import com.aaiagent.engine.ReplyDeliveryResult
import com.aaiagent.engine.ReplyDeliveryStatus
import com.aaiagent.engine.NextPartDecision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyDeliveryPolicyTest {
    @Test
    fun `delivery result is pessimistic until a completion path confirms it`() {
        assertFalse(
            ReplyDeliveryResult(
                status = ReplyDeliveryStatus.COMPLETE,
                sentParts = 1,
                totalParts = 1,
            ).confirmed
        )
    }

    @Test
    fun `new incoming cancels only before the first part is sent`() {
        assertEquals(
            NextPartDecision.CANCEL_STALE,
            ReplyDeliveryPolicy.nextPartDecision(
                sentParts = 0,
                incomingChanged = true,
                staleRequested = false
            )
        )
        assertEquals(
            NextPartDecision.SEND,
            ReplyDeliveryPolicy.nextPartDecision(
                sentParts = 1,
                incomingChanged = true,
                staleRequested = false
            )
        )
    }

    @Test
    fun `stale request cancels only before the first part is sent`() {
        assertEquals(
            NextPartDecision.CANCEL_STALE,
            ReplyDeliveryPolicy.nextPartDecision(
                sentParts = 0,
                incomingChanged = false,
                staleRequested = true
            )
        )
        assertEquals(
            NextPartDecision.SEND,
            ReplyDeliveryPolicy.nextPartDecision(
                sentParts = 2,
                incomingChanged = false,
                staleRequested = true
            )
        )
    }

    @Test
    fun `all parts must be sent before reply is complete`() {
        val partial = ReplyDeliveryPolicy.progress(sentParts = 1, totalParts = 3)
        val complete = ReplyDeliveryPolicy.progress(sentParts = 3, totalParts = 3)

        assertTrue(partial.isPartial)
        assertFalse(partial.isComplete)
        assertTrue(complete.isComplete)
        assertFalse(complete.isPartial)
    }

    @Test
    fun `partial delivery keeps the unsent tail for retry`() {
        val parts = listOf("第一句", "第二句", "第三句")

        assertEquals(listOf("第二句", "第三句"), ReplyDeliveryPolicy.remaining(parts, sentParts = 1))
        assertEquals(emptyList<String>(), ReplyDeliveryPolicy.remaining(parts, sentParts = 3))
    }

    @Test
    fun `natural short replies are not padded to three parts`() {
        assertEquals(listOf("在的"), ReplyDeliveryPolicy.prepareParts(listOf("在的")))
        assertEquals(
            listOf("在的 刚忙完"),
            ReplyDeliveryPolicy.prepareParts(listOf("在的", "刚忙完"))
        )
    }

    @Test
    fun `more than three parts are compacted instead of sent as a long burst`() {
        assertEquals(
            listOf("一 二 三 四 五"),
            ReplyDeliveryPolicy.prepareParts(listOf("一", "二", "三", "四", "五"))
        )
    }

    @Test
    fun `planning folds incomplete fragments into one natural bubble`() {
        assertEquals(
            listOf("一 二 三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.1)
        )
        assertEquals(
            listOf("一 二 三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.5)
        )
        assertEquals(
            listOf("一 二 三"),
            ReplyDeliveryPolicy.planParts(listOf("一", "二", "三"), randomUnit = 0.95)
        )
    }

    @Test
    fun `two model parts can still be sent as one short reply`() {
        assertEquals(
            listOf("在的 刚忙完"),
            ReplyDeliveryPolicy.planParts(listOf("在的", "刚忙完"), randomUnit = 0.2)
        )
    }

    @Test
    fun `an unmarked long reply is sent as one bubble`() {
        // Regression: the app used to chop a model sentence at spaces, so
        // "大十岁而已 装什么老 番茄芒果" arrived as three fragments.
        val longReply = "在的 刚忙完 你想聊什么就直说 我看到消息会回你 不用一直等我"

        assertEquals(
            listOf(longReply),
            ReplyDeliveryPolicy.planParts(listOf(longReply), randomUnit = 0.1),
        )
        assertEquals(
            listOf(longReply),
            ReplyDeliveryPolicy.planParts(listOf(longReply), randomUnit = 0.95),
        )
    }

    @Test
    fun `space separated points without a separator stay in one bubble`() {
        val first = "自己住清静，我也一个人住惯了，屋子随便收拾 严肃是因为说的都是正经话，没在跟你谈生意 不累，刚收拾完坐下"
        assertEquals(listOf(first), ReplyDeliveryPolicy.planParts(listOf(first)))

        val second = "强势跟年纪没关系，是懒得绕弯子 过来人这话我认，都离过，谁也不装嫩 看我可以，但得说清楚看什么，我又不是货架上的东西让人随便挑"
        assertEquals(listOf(second), ReplyDeliveryPolicy.planParts(listOf(second)))
    }

    @Test
    fun `unmarked sentences are not re-split at their terminals`() {
        val reply = "不爱拍是真的，不是端着。你到家了没？还是还在那坐着？"
        assertEquals(listOf(reply), ReplyDeliveryPolicy.planParts(listOf(reply)))
        assertEquals(
            listOf("我用 iPhone 15 Pro 拍"),
            ReplyDeliveryPolicy.planParts(listOf("我用 iPhone 15 Pro 拍"))
        )
    }

    @Test
    fun `two sentences in one unmarked reply stay together`() {
        assertEquals(
            listOf("还在工位摸鱼。你呢，忙不忙？"),
            ReplyDeliveryPolicy.planParts(listOf("还在工位摸鱼。你呢，忙不忙？"))
        )
    }

    @Test
    fun `preserves sentence and question punctuation`() {
        assertEquals(
            listOf("你也是重庆的？"),
            ReplyDeliveryPolicy.planParts(listOf("你也是重庆的？"))
        )
        assertEquals(
            listOf("哪有什么另一面，不就一普通人。"),
            ReplyDeliveryPolicy.planParts(listOf("哪有什么另一面，不就一普通人。"))
        )
    }

    @Test
    fun `clauses are never cut apart locally`() {
        val unmarked = "一个人久了确实这样，尤其到晚上，安静下来就容易想东想西"
        assertEquals(listOf(unmarked), ReplyDeliveryPolicy.planParts(listOf(unmarked)))
    }

    @Test
    fun `complete sentence bubbles stay separate`() {
        assertEquals(
            listOf("第一句。", "第二句？"),
            ReplyDeliveryPolicy.planParts(listOf("第一句。", "第二句？"))
        )
    }

    @Test
    fun `drops an immediate duplicate bubble before sending`() {
        assertEquals(
            listOf("在的，怎么了？"),
            ReplyDeliveryPolicy.planParts(listOf("在的，怎么了？", "在的，怎么了？"))
        )
    }

    @Test
    fun `short reply is not split just to imitate typing`() {
        assertEquals(
            listOf("这会儿不方便语音，打字聊吧"),
            ReplyDeliveryPolicy.planParts(listOf("这会儿不方便语音，打字聊吧"))
        )
    }

    @Test
    fun `new incoming history invalidates while a transient empty read does not`() {
        assertTrue(ReplyDeliveryPolicy.incomingChanged("old", "new"))
        assertFalse(ReplyDeliveryPolicy.incomingChanged("old", ""))
        assertFalse(ReplyDeliveryPolicy.incomingChanged("same", "same"))
    }

    @Test
    fun `recomputed reply fingerprints replace the stale original`() {
        assertEquals("fresh", ReplyDeliveryPolicy.effectiveFingerprint("fresh", "old"))
        assertEquals("old", ReplyDeliveryPolicy.effectiveFingerprint(null, "old"))
        assertEquals("old", ReplyDeliveryPolicy.effectiveFingerprint("", "old"))
    }

    @Test
    fun `follow-up bubbles use short fast typing delays`() {
        assertEquals(350L, ReplyDeliveryPolicy.delayAfterPart("短句", 0.0))
        assertEquals(650L, ReplyDeliveryPolicy.delayAfterPart("短句", 1.0))
        assertEquals(700L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 0.0))
        assertEquals(1100L, ReplyDeliveryPolicy.delayAfterPart("这是一条超过十六个字的较长回复内容", 1.0))
    }
}
