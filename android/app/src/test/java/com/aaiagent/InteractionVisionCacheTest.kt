package com.aaiagent

import com.aaiagent.engine.InteractionVisionCache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InteractionVisionCacheTest {
    @Test
    fun `stable identity produces a stable cache key`() {
        val first = InteractionVisionCache.cacheKey("soul:other:interaction:123")
        val second = InteractionVisionCache.cacheKey("soul:other:interaction:123")

        assertEquals(first, second)
        assertEquals(64, first.length)
        assertTrue(first.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `blank identity is not cached`() {
        assertEquals("", InteractionVisionCache.cacheKey("   "))
    }
}
