package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.SoulMediaType
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.LocalMediaReplyPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LocalMediaReplyPolicyTest {
    @Test
    fun `plain voice only uses the voice reply without model work`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(ChatMessage("other", "[语音]", SoulMediaType.VOICE))
            )
        )

        assertEquals(LocalMediaReplyPolicy.VOICE_REPLY, LocalMediaReplyPolicy.replyFor(batch))
    }

    @Test
    fun `voice emoji uses the voice emoji reply without model work`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(ChatMessage("other", "[语音互动表情]", SoulMediaType.VOICE_EMOJI))
            )
        )

        assertEquals(LocalMediaReplyPolicy.VOICE_EMOJI_REPLY, LocalMediaReplyPolicy.replyFor(batch))
    }

    @Test
    fun `text only does not use a local media reply`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(ChatMessage("other", "在吗", "text"))
            )
        )

        assertNull(LocalMediaReplyPolicy.replyFor(batch))
    }

    @Test
    fun `voice mixed with text is not treated as a voice only event`() {
        val batch = requireNotNull(
            IncomingMessageBatch.select(
                listOf(
                    ChatMessage("other", "[语音]", SoulMediaType.VOICE),
                    ChatMessage("other", "你听一下", "text")
                )
            )
        )

        assertNull(LocalMediaReplyPolicy.replyFor(batch))
    }
}
