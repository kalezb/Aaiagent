package com.aaiagent

import com.aaiagent.engine.IncomingMessageTracker
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingMessageTrackerTest {
    @Test
    fun `whitespace-only updates do not invalidate a pending reply`() {
        val previous = IncomingMessageTracker.fingerprint("你好 在吗")

        assertFalse(IncomingMessageTracker.isNew(previous, "你好  在吗"))
        assertFalse(IncomingMessageTracker.isNew(previous, "   "))
    }

    @Test
    fun `a different incoming message invalidates a pending reply`() {
        val previous = IncomingMessageTracker.fingerprint("你好 在吗")

        assertTrue(IncomingMessageTracker.isNew(previous, "你在干嘛"))
    }
}
