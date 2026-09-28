package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.ReplyDeliveryPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingMessageBatchTest {
    @Test
    fun `image followed by caption keeps the image as the media target`() {
        val image = ChatMessage("other", "[图片]", "image")
        val caption = ChatMessage("other", "我今天穿这套衣服", "text")

        val batch = IncomingMessageBatch.select(listOf(image, caption))

        assertEquals(caption, batch?.latestIncoming)
        assertSame(image, batch?.mediaTarget)
    }

    @Test
    fun `exchange stays ahead of captions and stickers`() {
        val exchange = ChatMessage("other", "[以图换图]", "exchange")
        val caption = ChatMessage("other", "你换一张给我看看", "text")
        val sticker = ChatMessage("other", "[表情]", "sticker")

        val batch = IncomingMessageBatch.select(listOf(exchange, caption, sticker))

        assertSame(exchange, batch?.mediaTarget)
    }

    @Test
    fun `image is preferred over a later sticker`() {
        val image = ChatMessage("other", "[图片]", "image")
        val sticker = ChatMessage("other", "[表情]", "sticker")

        val batch = IncomingMessageBatch.select(listOf(image, sticker))

        assertSame(image, batch?.mediaTarget)
    }

    @Test
    fun `the newest image wins when several images are sent together`() {
        val first = ChatMessage("other", "[图片]", "image")
        val second = ChatMessage("other", "[图片]", "image")

        val batch = IncomingMessageBatch.select(listOf(first, second))

        assertSame(second, batch?.mediaTarget)
    }

    @Test
    fun `text only batch does not invent a media target`() {
        val batch = IncomingMessageBatch.select(
            listOf(ChatMessage("other", "在吗", "text"))
        )

        assertEquals("在吗", batch?.latestIncoming?.content)
        assertNull(batch?.mediaTarget)
    }

    @Test
    fun `messages before the latest self reply are already handled`() {
        val oldImage = ChatMessage("other", "[图片]", "image")
        val selfReply = ChatMessage("self", "看到了", "text")
        val newCaption = ChatMessage("other", "这张呢", "text")

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
        val firstPoke = ChatMessage("other", "[拍一拍]", "interaction")
        val selfReply = ChatMessage("self", "别拍啦 打字说吧", "text")
        val secondPoke = ChatMessage("other", "[拍一拍]", "interaction")

        val firstEvent = IncomingMessageBatch.visibleFingerprint(listOf(firstPoke))
        val secondEvent = IncomingMessageBatch.visibleFingerprint(
            listOf(firstPoke, selfReply, secondPoke)
        )

        org.junit.Assert.assertNotEquals(firstEvent, secondEvent)
    }

    @Test
    fun `identical visible sequence remains stable when stale unread is reread`() {
        val messages = listOf(
            ChatMessage("other", "[拍一拍]", "interaction"),
            ChatMessage("self", "别拍啦 打字说吧", "text")
        )

        assertEquals(
            IncomingMessageBatch.visibleFingerprint(messages),
            IncomingMessageBatch.visibleFingerprint(messages)
        )
    }

    @Test
    fun `incoming history fingerprint detects a repeated message after our reply`() {
        val first = ChatMessage("other", "在吗", "text")
        val selfReply = ChatMessage("self", "在的", "text")
        val repeated = ChatMessage("other", "在吗", "text")

        org.junit.Assert.assertNotEquals(
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(first, selfReply)),
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(first, selfReply, repeated))
        )
    }

    @Test
    fun `recognized interaction keeps the same stable identity`() {
        val raw = ChatMessage(
            sender = "other",
            content = "[Soul互动表情]",
            type = "interaction",
            identityKey = "soul:other:interaction:100"
        )
        val recognized = raw.copy(
            content = "对方发来 Soul 互动表情「皮一下」：对方和你开玩笑，气氛轻松调皮",
            type = "text"
        )

        assertEquals(
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(raw)),
            IncomingMessageBatch.incomingHistoryFingerprint(listOf(recognized))
        )
    }

    @Test
    fun `old messages scrolling out do not invalidate the pending reply`() {
        val first = ChatMessage("other", "第一条", "text", identityKey = "1")
        val second = ChatMessage("other", "第二条", "text", identityKey = "2")
        val third = ChatMessage("other", "第三条", "text", identityKey = "3")
        val fourth = ChatMessage("other", "第四条", "text", identityKey = "4")

        val expected = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(first, second, third, fourth)
        )
        val current = IncomingMessageBatch.incomingHistoryFingerprint(listOf(third, fourth))

        assertFalse(ReplyDeliveryPolicy.incomingChanged(expected, current))
    }

    @Test
    fun `a genuinely new incoming message invalidates the pending reply`() {
        val first = ChatMessage("other", "第一条", "text", identityKey = "1")
        val second = ChatMessage("other", "第二条", "text", identityKey = "2")
        val third = ChatMessage("other", "第三条", "text", identityKey = "3")
        val fourth = ChatMessage("other", "第四条", "text", identityKey = "4")
        val newer = ChatMessage("other", "新消息", "text", identityKey = "5")

        val expected = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(first, second, third, fourth)
        )
        val current = IncomingMessageBatch.incomingHistoryFingerprint(
            listOf(second, third, fourth, newer)
        )

        assertTrue(ReplyDeliveryPolicy.incomingChanged(expected, current))
    }
}
