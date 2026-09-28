package com.aaiagent

import com.aaiagent.adapter.SoulMessageIdentity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SoulMessageIdentityTest {
    @Test
    fun `different content in the same time bucket gets different identities`() {
        val first = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "first message",
            timestampText = "21:02",
            timestampMillis = null
        )
        val second = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "second message",
            timestampText = "21:02",
            timestampMillis = null
        )

        assertNotEquals(first, second)
    }

    @Test
    fun `same visible message keeps the same identity without relying on screen position`() {
        val first = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "same message",
            timestampText = "21:03",
            timestampMillis = null
        )
        val reread = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "same message",
            timestampText = "21:03",
            timestampMillis = null
        )

        assertEquals(first, reread)
    }

    @Test
    fun `relative now label stays stable when the timestamp is recalculated`() {
        val first = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "32",
            timestampText = "刚刚",
            timestampMillis = 1_000L
        )
        val reread = SoulMessageIdentity.key(
            sender = "other",
            type = "text",
            content = "32",
            timestampText = "刚刚",
            timestampMillis = 9_000L
        )

        assertEquals(first, reread)
    }
}
