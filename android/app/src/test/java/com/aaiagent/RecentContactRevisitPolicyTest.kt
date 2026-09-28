package com.aaiagent

import com.aaiagent.engine.RecentContactRevisitPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentContactRevisitPolicyTest {
    @Test
    fun `visit is only due after the short post-send delay`() {
        val visit = RecentContactRevisitPolicy.schedule(
            platform = "soul",
            contactId = "alice",
            contactName = "alice",
            now = 1_000L,
        )

        assertNull(RecentContactRevisitPolicy.findDue(listOf(visit), "soul", 2_199L))
        assertNotNull(RecentContactRevisitPolicy.findDue(listOf(visit), "soul", 2_200L))
        assertNull(RecentContactRevisitPolicy.findDue(listOf(visit), "qq", 2_200L))
    }

    @Test
    fun `a revisit gets at most two attempts and then expires`() {
        val visit = RecentContactRevisitPolicy.schedule(
            platform = "soul",
            contactId = "alice",
            contactName = "alice",
            now = 1_000L,
        )

        val second = RecentContactRevisitPolicy.afterAttempt(visit, 2_200L)
        assertNotNull(second)
        assertEquals(1, second?.attempts)
        assertEquals(3_400L, second?.dueAt)

        val third = RecentContactRevisitPolicy.afterAttempt(requireNotNull(second), 3_400L)
        assertNull(third)
    }

    @Test
    fun `expired visits are removed and matching ignores relative title decorations`() {
        val visit = RecentContactRevisitPolicy.schedule(
            platform = "soul",
            contactId = "alice",
            contactName = "小明",
            now = 1_000L,
        )

        assertTrue(
            RecentContactRevisitPolicy.matches(visit, "小明 在线")
        )
        assertFalse(
            RecentContactRevisitPolicy.matches(visit, "小红")
        )
        assertTrue(
            RecentContactRevisitPolicy.retainActive(
                listOf(visit),
                now = visit.expiresAt + 1L,
            ).isEmpty()
        )
    }
}
