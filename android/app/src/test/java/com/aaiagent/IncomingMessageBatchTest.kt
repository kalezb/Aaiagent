package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.SoulMessageIdentity
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.ReplyDeliveryPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingMessageBatchTest {
    @Test
    fun `image followed by caption keeps the image as the media target`() {
        val image = ChatMessage("other", "[image]", "image")
        val caption = ChatMessage("other", "today outfit", "text")

        val batch = IncomingMessageBatch.select(listOf(image, caption))

        assertEquals(caption, batch?.latestIncoming)
        assertSame(image, batch?.mediaTarget)
    }

    @Test
    fun `exchange stays ahead of captions and stickers`() {
        val exchange = ChatMessage("other", "[exchange]", "exchange")
        val caption = ChatMessage("other", "send one back", "text")
        val sticker = ChatMessage("other", "[sticker]", "sticker")

        val batch = IncomingMessageBatch.select(listOf(exchange, caption, sticker))

        assertSame(exchange, batch?.mediaTarget)
    }

    @Test
    fun `image is preferred over a later sticker`() {
        val image = ChatMessage("other", "[image]", "image")
        val sticker = ChatMessage("other", "[sticker]", "sticker")

        val batch = IncomingMessageBatch.select(listOf(image, sticker))

        assertSame(image, batch?.mediaTarget)
    }

    @Test
    fun `the newest image wins when several images are sent together`() {
        val first = ChatMessage("other", "[image]", "image")
        val second = ChatMessage("other", "[image]", "image")

        val batch = IncomingMessageBatch.select(listOf(first, second))

        assertSame(second, batch?.mediaTarget)
    }

    @Test
    fun `text only batch does not invent a media target`() {
        val batch = IncomingMessageBatch.select(
            listOf(ChatMessage("other", "hello", "text"))
        )

        assertEquals("hello", batch?.latestIncoming?.content)
        assertNull(batch?.mediaTarget)
    }

    @Test
    fun `messages before the latest self reply are already handled`() {
        val oldImage = ChatMessage("other", "[image]", "image")
        val selfReply = ChatMessage("self", "seen", "text")
        val newCaption = ChatMessage("other", "this one", "text")

        val batch = IncomingMessageBatch.select(listOf(oldImage, selfReply, newCaption))

        assertEquals(listOf(newCaption), batch?.incoming)
        assertNull(batch?.mediaTarget)
    }

    @Test
    fun `fingerprint excludes incoming messages before the latest self reply`() {
        val oldImage = ChatMessage("other", "[old image]", "image")
        val selfReply = ChatMessage("self", "already handled", "text")
        val newText = ChatMessage("other", "new message", "text")

        val fullBatch = requireNotNull(IncomingMessageBatch.select(listOf(oldImage, selfReply, newText)))
        val newBatch = requireNotNull(IncomingMessageBatch.select(listOf(newText)))

        assertEquals(IncomingMessageBatch.fingerprint(newBatch), IncomingMessageBatch.fingerprint(fullBatch))
    }

    @Test
    fun `visible fingerprint distinguishes a repeated interaction after our reply`() {
        val firstPoke = ChatMessage("other", "[poke]", "interaction")
        val selfReply = ChatMessage("self", "do not poke", "text")
        val secondPoke = ChatMessage("other", "[poke]", "interaction")

        val firstEvent = IncomingMessageBatch.visibleFingerprint(listOf(firstPoke))
        val secondEvent = IncomingMessageBatch.visibleFingerprint(
            listOf(firstPoke, selfReply, secondPoke)
        )

        assertNotEquals(firstEvent, secondEvent)
    }

    @Test
    fun `identical visible sequence remains stable when stale unread is reread`() {
        val messages = listOf(
            ChatMessage("other", "[poke]", "interaction"),
            ChatMessage("self", "do not poke", "text")
        )

        assertEquals(
            IncomingMessageBatch.visibleFingerprint(messages),
            IncomingMessageBatch.visibleFingerprint(messages)
        )
    }

    @Test
    fun `incoming history fingerprint detects a repeated message after our reply`() {
        val first = ChatMessage("other", "hello", "text")
        val selfReply = ChatMessage("self", "here", "text")
        val repeated = ChatMessage("other", "hello", "text")

        assertNotEquals(
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(first, selfReply)),
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(first, selfReply, repeated))
        )
    }

    @Test
    fun `recognized interaction keeps the same stable identity`() {
        val raw = ChatMessage(
            sender = "other",
            content = "[interaction]",
            type = "interaction",
            identityKey = "soul:other:interaction:100"
        )
        val recognized = raw.copy(
            content = "the other person poked you",
            type = "text"
        )

        assertEquals(
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(raw)),
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(recognized))
        )
    }

    @Test
    fun `different messages in the same Soul time bucket do not collide`() {
        val previous = listOf(
            ChatMessage(
                sender = "other",
                content = "old message",
                identityKey = SoulMessageIdentity.key(
                    sender = "other",
                    type = "text",
                    content = "old message",
                    timestampText = "21:02",
                    timestampMillis = null
                )
            )
        )
        val current = listOf(
            ChatMessage(
                sender = "other",
                content = "new message",
                identityKey = SoulMessageIdentity.key(
                    sender = "other",
                    type = "text",
                    content = "new message",
                    timestampText = "21:02",
                    timestampMillis = null
                )
            )
        )

        assertNotEquals(
            IncomingMessageBatch.incomingHistoryFingerprint(previous),
            IncomingMessageBatch.incomingHistoryFingerprint(current)
        )
    }

    @Test
    fun `old messages scrolling out do not invalidate the pending reply`() {
        val first = ChatMessage("other", "one", "text", identityKey = "1")
        val second = ChatMessage("other", "two", "text", identityKey = "2")
        val third = ChatMessage("other", "three", "text", identityKey = "3")
        val fourth = ChatMessage("other", "four", "text", identityKey = "4")

        val expected = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(first, second, third, fourth)
        )
        val current = IncomingMessageBatch.incomingHistoryFingerprint(listOf(third, fourth))

        assertFalse(ReplyDeliveryPolicy.incomingChanged(expected, current))
    }

    @Test
    fun `a genuinely new incoming message invalidates the pending reply`() {
        val first = ChatMessage("other", "one", "text", identityKey = "1")
        val second = ChatMessage("other", "two", "text", identityKey = "2")
        val third = ChatMessage("other", "three", "text", identityKey = "3")
        val fourth = ChatMessage("other", "four", "text", identityKey = "4")
        val newer = ChatMessage("other", "new", "text", identityKey = "5")

        val expected = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(first, second, third, fourth)
        )
        val current = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(second, third, fourth, newer)
        )

        assertTrue(ReplyDeliveryPolicy.incomingChanged(expected, current))
    }
}
