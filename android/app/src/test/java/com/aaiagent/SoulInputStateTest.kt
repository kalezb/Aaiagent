package com.aaiagent

import com.aaiagent.engine.SoulInputState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulInputStateTest {
    @Test
    fun `dynamic Soul hint is treated as cleared when send button is gone`() {
        assertTrue(SoulInputState.isCleared(inChat = true, sendButtonVisible = false))
    }

    @Test
    fun `visible send button means input still contains text`() {
        assertFalse(SoulInputState.isCleared(inChat = true, sendButtonVisible = true))
    }

    @Test
    fun `matching input text is not treated as cleared`() {
        assertFalse(
            SoulInputState.isCleared(
                inChat = true,
                sendButtonVisible = false,
                inputStillContainsExpected = true
            )
        )
    }

    @Test
    fun `input is not cleared outside chat`() {
        assertFalse(SoulInputState.isCleared(inChat = false, sendButtonVisible = false))
    }
}
