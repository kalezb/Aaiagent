package com.aaiagent

import com.aaiagent.engine.ConversationContextRetentionPolicy
import com.aaiagent.engine.ConversationContextStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class ConversationContextStoreTest {
    @Test
    fun `same platform and contact reuse one context`() {
        var now = 1_000L
        val store = ConversationContextStore(now = { now })

        val first = store.getOrCreate("soul", "contact-1")
        now = 2_000L
        val second = store.getOrCreate("soul", "contact-1")

        assertSame(first, second)
        assertEquals(2_000L, second.lastTouchedAtMs)
        assertEquals(1, store.size())
    }

    @Test
    fun `different platforms keep separate contexts for the same contact`() {
        val store = ConversationContextStore(now = { 1_000L })

        val soul = store.getOrCreate("soul", "contact-1")
        val qq = store.getOrCreate("qq", "contact-1")

        assertEquals("soul", soul.platform)
        assertEquals("qq", qq.platform)
        assertEquals(2, store.size())
    }

    @Test
    fun `store stays within the context budget`() {
        var now = 1_000L
        val store = ConversationContextStore(now = { now })

        repeat(ConversationContextRetentionPolicy.MAX_CONTEXTS + 5) { index ->
            now += 1L
            store.getOrCreate("soul", "contact-$index")
        }

        assertEquals(ConversationContextRetentionPolicy.MAX_CONTEXTS, store.size())
    }
}
