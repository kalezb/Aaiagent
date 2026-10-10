package com.aaiagent

import com.aaiagent.engine.ConversationTaskGate
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationTaskGateTest {
    @Test
    fun `only one conversation task can own the chat page`() {
        val gate = ConversationTaskGate()

        assertTrue(gate.tryBegin())
        assertTrue(gate.isActive())
        assertFalse(gate.tryBegin())

        gate.finish()
        assertFalse(gate.isActive())
        assertTrue(gate.tryBegin())
    }
}
