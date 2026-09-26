package com.aaiagent

import com.aaiagent.adapter.SoulInteractionMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulInteractionMessageTest {
    @Test
    fun `pat head system text extracts any dynamic nickname`() {
        val parsed = SoulInteractionMessage.parseSystemText(
            "“ 期待下一步的我们 ” 摸了摸我的头"
        )

        assertEquals("期待下一步的我们", parsed?.actorName)
        assertEquals("摸一下", parsed?.displayName)
    }

    @Test
    fun `pat head system text is not hardcoded to one account`() {
        val parsed = SoulInteractionMessage.parseSystemText(
            "\"Alice_2026\" 摸了摸我的头"
        )

        assertEquals("Alice_2026", parsed?.actorName)
        assertEquals("摸一下", parsed?.displayName)
    }

    @Test
    fun `pat head system text accepts an unquoted nickname`() {
        val parsed = SoulInteractionMessage.parseSystemText(
            "期待下一步的我们 摸了摸我的头"
        )

        assertEquals("期待下一步的我们", parsed?.actorName)
        assertEquals("摸一下", parsed?.displayName)
    }

    @Test
    fun `pat head system text accepts quotes around the whole sentence`() {
        val parsed = SoulInteractionMessage.parseSystemText(
            "“另一个客户 摸了摸我的头”"
        )

        assertEquals("另一个客户", parsed?.actorName)
        assertEquals("摸一下", parsed?.displayName)
    }

    @Test
    fun `unrelated system text is rejected`() {
        assertNull(SoulInteractionMessage.parseSystemText("“期待下一步的我们” 拍了拍你"))
        assertNull(SoulInteractionMessage.parseSystemText("摸了摸我的头"))
        assertNull(SoulInteractionMessage.parseSystemText("“” 摸了摸我的头"))
    }
}
