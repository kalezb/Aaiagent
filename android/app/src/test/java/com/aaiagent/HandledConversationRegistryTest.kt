package com.aaiagent

import com.aaiagent.engine.HandledConversationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HandledConversationRegistryTest {
    @Test
    fun `marks handled contacts only for the current platform`() {
        var platform = "soul"
        val registry = HandledConversationRegistry(currentPlatform = { platform })

        registry.mark("contact-1")
        assertTrue(registry.contains("contact-1"))

        platform = "qq"
        assertFalse(registry.contains("contact-1"))
        registry.mark("contact-1")
        assertTrue(registry.contains("contact-1"))
    }

    @Test
    fun `clear removes all handled contacts`() {
        val registry = HandledConversationRegistry(currentPlatform = { "soul" })
        registry.mark("contact-1")
        registry.mark("contact-2")

        registry.clear()

        assertFalse(registry.contains("contact-1"))
        assertFalse(registry.contains("contact-2"))
    }
}
