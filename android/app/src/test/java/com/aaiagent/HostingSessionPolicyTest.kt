package com.aaiagent

import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.HostingSessionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Assert.assertNull

class HostingSessionPolicyTest {
    @Test
    fun `resumes only when hosting was explicitly enabled and token exists`() {
        assertTrue(HostingSessionPolicy.shouldResume("true", "mykey"))
        assertFalse(HostingSessionPolicy.shouldResume("false", "mykey"))
        assertFalse(HostingSessionPolicy.shouldResume("true", ""))
        assertFalse(HostingSessionPolicy.shouldResume(null, "mykey"))
    }

    @Test
    fun `keeps an in-process session so a recreated service can continue hosting`() {
        try {
            HostingSessionPolicy.markStarted(" soul ", HostingMode.SEMI_AUTO)
            val session = HostingSessionPolicy.processSession()
            assertEquals("soul", session?.platform)
            assertEquals(HostingMode.SEMI_AUTO, session?.mode)
            assertTrue(HostingSessionPolicy.canRestoreFromPersistence())

            HostingSessionPolicy.markStopped()
            assertNull(HostingSessionPolicy.processSession())
            assertFalse(HostingSessionPolicy.canRestoreFromPersistence())
        } finally {
            HostingSessionPolicy.markStopped()
        }
    }

    @Test
    fun `explicit stop prevents stale persisted state from restarting hosting`() {
        try {
            HostingSessionPolicy.markStarted("soul", HostingMode.FULL_AUTO)
            HostingSessionPolicy.markStopped()
            assertFalse(HostingSessionPolicy.canRestoreFromPersistence())

            HostingSessionPolicy.markStarted("soul", HostingMode.FULL_AUTO)
            assertTrue(HostingSessionPolicy.canRestoreFromPersistence())
        } finally {
            HostingSessionPolicy.markStopped()
        }
    }

    @Test
    fun `restores a complete persisted session only when token is present`() {
        val session = HostingSessionPolicy.restoredSession(
            enabledValue = "true",
            token = "mykey",
            platformValue = " soul ",
            modeValue = "FULL_AUTO"
        )
        assertEquals("soul", session?.platform)
        assertEquals(HostingMode.FULL_AUTO, session?.mode)

        assertNull(HostingSessionPolicy.restoredSession("true", null, "soul", "FULL_AUTO"))
        assertNull(HostingSessionPolicy.restoredSession("false", "mykey", "soul", "FULL_AUTO"))
    }

    @Test
    fun `restores known mode and falls back to full auto`() {
        assertEquals(HostingMode.SEMI_AUTO, HostingSessionPolicy.effectiveMode(null, "SEMI_AUTO"))
        assertEquals(HostingMode.FULL_AUTO, HostingSessionPolicy.effectiveMode(HostingMode.FULL_AUTO, "SEMI_AUTO"))
        assertEquals(HostingMode.SEMI_AUTO, HostingSessionPolicy.hostingMode("SEMI_AUTO"))
        assertEquals(HostingMode.FULL_AUTO, HostingSessionPolicy.hostingMode("bad-value"))
        assertEquals(HostingMode.FULL_AUTO, HostingSessionPolicy.hostingMode(null))
    }
}
