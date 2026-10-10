package com.aaiagent

import com.aaiagent.engine.sampling.PageSampleNamingPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageSampleNamingPolicyTest {
    @Test
    fun `sample names are safe and sortable`() {
        val id = PageSampleNamingPolicy.incidentId(
            platform = "soul",
            sequence = 12,
            pageKind = "VERIFIED_CHAT",
            nowMs = 1_800_000_000_000L,
        )
        assertTrue(id.startsWith("page-sample-soul-0012-VERIFIED_CHAT-"))
        assertFalse(id.contains("/"))
        assertEquals("incident-$id.jsonl", PageSampleNamingPolicy.fileName(id))
    }

    @Test
    fun `unsafe label text is folded into a file-safe segment`() {
        assertEquals(
            "Soul_列表_未读",
            PageSampleNamingPolicy.safeSegment(" Soul 列表/未读 "),
        )
        assertEquals("unknown", PageSampleNamingPolicy.safeSegment("///"))
    }
}
