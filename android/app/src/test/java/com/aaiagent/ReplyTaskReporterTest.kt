package com.aaiagent

import com.aaiagent.engine.ReplyTaskReporter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyTaskReporterTest {
    @Test
    fun `does not send a report without a task id`() = runBlocking {
        val sent = mutableListOf<String>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val reporter = ReplyTaskReporter(
            scope = scope,
            activeToken = { "token-1" },
            sendReport = { _, taskId, _, _ -> sent += taskId },
        )

        try {
            reporter.report(null, "failed", "empty_content")
            reporter.report("  ", "failed", "empty_content")
            delay(50)
            assertTrue(sent.isEmpty())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `does not send a report without a device key`() = runBlocking {
        val sent = mutableListOf<String>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val reporter = ReplyTaskReporter(
            scope = scope,
            activeToken = { null },
            sendReport = { _, taskId, _, _ -> sent += taskId },
        )

        try {
            reporter.report("task-1", "failed", "empty_content")
            delay(50)
            assertTrue(sent.isEmpty())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `sends the task result with the trimmed device key`() = runBlocking {
        val sent = mutableListOf<List<String>>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val reporter = ReplyTaskReporter(
            scope = scope,
            activeToken = { " token-1 " },
            sendReport = { token, taskId, status, error ->
                sent += listOf(token, taskId, status, error)
            },
        )

        try {
            reporter.report("task-1", "sent", "")
            withTimeout(2_000) {
                while (sent.isEmpty()) delay(10)
            }
            assertEquals(
                listOf("token-1", "task-1", "sent", ""),
                sent.single(),
            )
        } finally {
            scope.cancel()
        }
    }
}
