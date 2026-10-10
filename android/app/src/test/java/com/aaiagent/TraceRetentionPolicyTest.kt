package com.aaiagent

import com.aaiagent.engine.observability.TraceRetentionPolicy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class TraceRetentionPolicyTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `keeps only the newest incident files`() {
        val now = System.currentTimeMillis()
        val files = (1..55).map { index ->
            temporaryFolder.newFile("incident-$index.jsonl").apply {
                setLastModified(now - index * 1_000L)
            }
        }

        val delete = TraceRetentionPolicy.incidentFilesToDelete(files, now)

        assertEquals(5, delete.size)
    }

    @Test
    fun `deletes screenshots older than retention window`() {
        val now = System.currentTimeMillis()
        val old = temporaryFolder.newFile("old.jpg").apply {
            setLastModified(now - TraceRetentionPolicy.MAX_AGE_MS - 1_000L)
        }
        val fresh = temporaryFolder.newFile("fresh.jpg").apply {
            setLastModified(now)
        }

        assertEquals(listOf(old), TraceRetentionPolicy.screenshotFilesToDelete(listOf(old, fresh), now))
    }
}
