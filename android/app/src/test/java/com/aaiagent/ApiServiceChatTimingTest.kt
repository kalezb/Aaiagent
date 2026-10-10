package com.aaiagent

import com.aaiagent.network.ApiService
import com.aaiagent.network.ChatRequest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiServiceChatTimingTest {
    @Test
    fun `chat response exposes server ids and timing with network phases`() = runBlocking {
        val server = MockWebServer()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .addHeader("Content-Type", "application/json")
                    .setBody(
                        """
                        {
                          "action": "send",
                          "reply": "ok",
                          "reply_id": "reply-1",
                          "request_id": "request-1",
                          "timing": {
                            "persona_ms": 1,
                            "context_ms": 2,
                            "llm_ms": 3,
                            "main_llm_ms": 3,
                            "repair_ms": 0,
                            "total_ms": 6,
                            "repair_attempted": false,
                            "repair_timeout": false,
                            "llm_budget_ms": 10000
                          }
                        }
                        """.trimIndent()
                    )
            )
            server.start()

            val service = ApiService(server.url("/").toString().trimEnd('/'))
            val result = service.chat(
                chatRequest(
                    requestId = "timing-request",
                    conversationStage = "first_contact",
                    relationshipOrigin = "match",
                )
            )

            assertEquals("request-1", result.response.requestId)
            assertEquals(3L, result.response.timing?.llmMs)
            assertEquals(6L, result.response.timing?.totalMs)
            assertNotNull(result.networkTiming.totalMs)
            val sent = server.takeRequest()
            assertEquals("/api/chat", sent.path)
            val sentBody = sent.body.readUtf8()
            assertTrue(sentBody.contains("\"conversation_stage\":\"first_contact\""))
            assertTrue(sentBody.contains("\"relationship_origin\":\"match\""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `chat preserves server timeout metadata from a non-success response`() = runBlocking {
        val server = MockWebServer()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(504)
                    .addHeader("Content-Type", "application/json")
                    .setBody(
                        """
                        {
                          "error": "model timeout",
                          "code": "llm_timeout",
                          "request_id": "request-timeout",
                          "timing": {
                            "llm_ms": 10000,
                            "main_llm_ms": 10000,
                            "total_ms": 10010,
                            "llm_budget_ms": 10000
                          }
                        }
                        """.trimIndent()
                    )
            )
            server.start()

            val service = ApiService(server.url("/").toString().trimEnd('/'))
            val result = service.chat(chatRequest("server-timeout-request"))

            assertEquals("llm_timeout", result.response.code)
            assertEquals("request-timeout", result.response.requestId)
            assertEquals(10_000L, result.response.timing?.mainLlmMs)
            assertNotNull(result.networkTiming.totalMs)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `chat request stops at the configured call timeout`() = runBlocking {
        val server = MockWebServer()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .setBody("""{"action":"send","reply":"late"}""")
                    .setBodyDelay(600, TimeUnit.MILLISECONDS)
            )
            server.start()

            val service = ApiService(
                baseUrl = server.url("/").toString().trimEnd('/'),
                modelReadTimeoutMs = 100,
                modelCallTimeoutMs = 150
            )
            val startedAtNanos = System.nanoTime()
            val failure = try {
                service.chat(chatRequest("timeout-request"))
                null
            } catch (error: Exception) {
                error
            }
            val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAtNanos)

            assertTrue(failure is IOException)
            assertTrue("request took ${elapsedMs}ms", elapsedMs < 500)
        } finally {
            server.shutdown()
        }
    }

    private fun chatRequest(
        requestId: String,
        conversationStage: String = "unknown",
        relationshipOrigin: String = "unknown",
    ): ChatRequest {
        return ChatRequest(
            token = "test-token",
            platform = "soul",
            hostingMode = "full_auto",
            requestId = requestId,
            contactId = "contact-1",
            contactName = "contact",
            conversationStage = conversationStage,
            relationshipOrigin = relationshipOrigin,
            messages = listOf(
                mapOf(
                    "role" to "user",
                    "content" to "hello",
                    "timestamp" to "",
                    "created_at" to 0L
                )
            )
        )
    }
}
