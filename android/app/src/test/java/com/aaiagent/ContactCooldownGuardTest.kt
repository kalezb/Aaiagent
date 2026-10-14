package com.aaiagent

import com.aaiagent.engine.ContactCooldownGuard
import com.aaiagent.engine.ConversationContext
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactCooldownGuardTest {
    @Test
    fun `checks both contact id and name against the saved pause`() = runBlocking {
        var now = 1_000L
        val guard = ContactCooldownGuard(
            currentPlatform = { "soul" },
            readLeaveUntil = { platform, key ->
                assertEquals("soul", platform)
                if (key == "contact-1") 2_000L else 0L
            },
            writeLeaveUntil = { _, _, _ -> },
            recordRecovery = {},
            now = { now },
        )

        assertTrue(guard.isCoolingDown("梦想", "contact-1"))
        now = 2_000L
        assertFalse(guard.isCoolingDown("梦想", "contact-1"))
    }

    @Test
    fun `keeps the current short block for a contact`() {
        var now = 1_000L
        val guard = ContactCooldownGuard(
            currentPlatform = { "soul" },
            readLeaveUntil = { _, _ -> null },
            writeLeaveUntil = { _, _, _ -> },
            recordRecovery = {},
            now = { now },
        )

        guard.block("梦想", retryAfterMs = 60_000L)
        assertTrue(guard.isBlocked("梦想", "contact-1"))
        now += 60_001L
        assertFalse(guard.isBlocked("梦想", "contact-1"))
    }

    @Test
    fun `saves a leave pause for at least one minute`() = runBlocking {
        val writes = mutableListOf<Triple<String, String, Long>>()
        val journal = mutableListOf<String>()
        val context = ConversationContext(
            platform = "soul",
            contactId = "contact-1",
            contactName = "梦想",
        )
        val guard = ContactCooldownGuard(
            currentPlatform = { "soul" },
            readLeaveUntil = { _, _ -> null },
            writeLeaveUntil = { platform, key, untilMs ->
                writes += Triple(platform, key, untilMs)
            },
            recordRecovery = journal::add,
            now = { 1_000L },
        )

        guard.persistLeave(
            context = context,
            durationMs = 1_000L,
            reason = "test",
        )

        assertEquals(Triple("soul", "contact-1", 61_000L), writes.single())
        assertEquals(
            listOf("离开冷却已记录 contact=梦想 reason=test"),
            journal,
        )
    }
}
