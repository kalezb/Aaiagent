package com.aaiagent

import com.aaiagent.network.ApiService
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiServiceModelRouteHealthTest {
    @Test
    fun `line health uses the device key and parses the selected line`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"ok":true,"line":"b","provider":"gemini","latency_ms":123}""")
        )
        server.start()
        try {
            val result = ApiService(server.url("/").toString().trimEnd('/'))
                .checkModelRouteHealth("device-key", "B")

            assertEquals(true, result.ok)
            assertEquals("b", result.line)
            assertEquals(123L, result.latencyMs)
            val request = server.takeRequest()
            assertEquals("/api/model-route/health?line=b", request.path)
            assertEquals("Bearer device-key", request.getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `line health keeps a provider failure as a red result`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setResponseCode(503)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"ok":false,"line":"a","error":"线路连接失败","upstream_status":502}""")
        )
        server.start()
        try {
            val result = ApiService(server.url("/").toString().trimEnd('/'))
                .checkModelRouteHealth("device-key", "a")

            assertEquals(false, result.ok)
            assertEquals("线路连接失败", result.error)
            assertEquals(502, result.upstreamStatus)
            assertTrue(server.takeRequest().path.orEmpty().contains("line=a"))
        } finally {
            server.shutdown()
        }
    }
}
