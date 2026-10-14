package com.aaiagent

import com.aaiagent.engine.ContactAccessGuard
import com.aaiagent.engine.ContactCooldownGuard
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactAccessGuardTest {
    @Test
    fun `blocked contact is rejected before filters are read`() = runBlocking {
        var filterReads = 0
        val cooldown = cooldownGuard(blocked = true)
        val access = ContactAccessGuard(
            cooldown = cooldown,
            loadFilters = {
                filterReads += 1
                emptyList<String>() to emptyList()
            },
        )

        assertFalse(access.allows("梦想", "contact-1"))
        assertTrue(filterReads == 0)
    }

    @Test
    fun `non blocked contact still follows whitelist and blacklist`() = runBlocking {
        val access = ContactAccessGuard(
            cooldown = cooldownGuard(blocked = false),
            loadFilters = {
                listOf("梦想") to listOf("广告账号")
            },
        )

        assertTrue(access.allows("梦想", "contact-1"))
        assertFalse(access.allows("别人", "contact-2"))
        assertFalse(access.allows("广告账号", "contact-3"))
    }

    private fun cooldownGuard(blocked: Boolean): ContactCooldownGuard {
        val guard = ContactCooldownGuard(
            currentPlatform = { "soul" },
            readLeaveUntil = { _, _ -> null },
            writeLeaveUntil = { _, _, _ -> },
            recordRecovery = {},
            now = { 1_000L },
        )
        if (blocked) guard.block("梦想", retryAfterMs = 60_000L)
        return guard
    }
}
