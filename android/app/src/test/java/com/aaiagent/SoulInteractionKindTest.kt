package com.aaiagent

import com.aaiagent.adapter.SoulInteractionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulInteractionKindTest {
    @Test
    fun `light and static structures keep their own paths`() {
        assertEquals(
            SoulInteractionKind.LIGHT,
            SoulInteractionKind.resolve(true, false)
        )
        assertEquals(
            SoulInteractionKind.STATIC,
            SoulInteractionKind.resolve(false, true)
        )
    }

    @Test
    fun `ordinary content is not classified as an interaction`() {
        assertNull(SoulInteractionKind.resolve(false, false))
    }
}
