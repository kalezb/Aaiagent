package com.aaiagent

import com.aaiagent.network.ApiService
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ApiServiceAutomationIncidentTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `uploads the local incident timeline with its incident id`() = runBlocking {
        val server = MockWebServer()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(201)
                    .addHeader("Content-Type", "application/json")
                    .setBody("""{"success":true}""")
            )
            server.start()
            val file = temporaryFolder.newFile("incident-incident-123.jsonl").apply {
                writeText("""{"incidentId":"incident-123","event":"anomaly"}""" + "\n")
            }

            val uploaded = ApiService(server.url("/").toString().trimEnd('/'))
                .uploadAutomationIncident("test-token", file)

            assertTrue(uploaded)
            val request = server.takeRequest()
            assertEquals("/api/automation-incidents", request.path)
            assertEquals("Bearer test-token", request.getHeader("Authorization"))
            assertEquals("incident-123", request.getHeader("X-Incident-Id"))
            assertTrue(request.body.readUtf8().contains("\"event\":\"anomaly\""))
        } finally {
            server.shutdown()
        }
    }
}
