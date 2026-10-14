package com.aaiagent

import com.aaiagent.engine.RecentOutgoingSendMemory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentOutgoingSendMemoryTest {
    @Test
    fun `blocks the same long text for another contact inside the window`() {
        var now = 1_000L
        val memory = RecentOutgoingSendMemory(now = { now })

        memory.remember("今天忙完了再和你说", "contact-1")

        assertTrue(memory.isCrossContactRepeat("今天忙完了再和你说", "contact-2"))
        assertFalse(memory.isCrossContactRepeat("今天忙完了再和你说", "contact-1"))

        now += CrossContactWindow.MS + 1L
        assertFalse(memory.isCrossContactRepeat("今天忙完了再和你说", "contact-2"))
    }

    @Test
    fun `does not block a short normal phrase`() {
        val memory = RecentOutgoingSendMemory(now = { 1_000L })
        memory.remember("在呢", "contact-1")

        assertFalse(memory.isCrossContactRepeat("在呢", "contact-2"))
    }

    private object CrossContactWindow {
        const val MS = 5 * 60 * 1000L
    }
}
