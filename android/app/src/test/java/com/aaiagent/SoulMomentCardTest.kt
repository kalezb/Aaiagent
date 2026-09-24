package com.aaiagent

import com.aaiagent.adapter.SoulMomentCard
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMomentCardTest {
    @Test
    fun `formats forwarded moment author and content for the model`() {
        assertEquals(
            "[转发瞬间] 另一面的我：今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了",
            SoulMomentCard.format(
                author = "另一面的我",
                content = "今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了",
            ),
        )
    }

    @Test
    fun `does not require moment text when only the card shell is visible`() {
        assertEquals("[转发瞬间]", SoulMomentCard.format(null, null))
        assertEquals("[转发瞬间] 另一面的我", SoulMomentCard.format("另一面的我", null))
    }
}
