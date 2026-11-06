package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.StickerTurnPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StickerTurnPolicyTest {
    @Test
    fun `pure reaction sticker triggers a natural reply turn`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(listOf(ChatMessage("other", "[小害羞]", "sticker")))
        )

        assertTrue(StickerTurnPolicy.shouldReplyToBatch(batch))
    }

    @Test
    fun `greeting sticker still gets a natural reply`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(ChatMessage("other", "对方发来时段问候表情「晚安」", "text"))
            )
        )

        assertTrue(StickerTurnPolicy.shouldReplyToBatch(batch))
    }

    @Test
    fun `text with a reaction sticker stays one reply turn`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(
                    ChatMessage("other", "我", "text"),
                    ChatMessage("other", "对方发来 Soul 官方表情「小害羞」", "text"),
                )
            )
        )

        assertTrue(StickerTurnPolicy.shouldReplyToBatch(batch))
    }

    @Test
    fun `unknown dynamic visual still triggers a reply turn`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(ChatMessage("other", "[动态表情]", "dynamic_visual"))
            )
        )

        assertTrue(StickerTurnPolicy.shouldReplyToBatch(batch))
    }
}
