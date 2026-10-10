package com.aaiagent

import com.aaiagent.network.ApiService
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class ReplyAuditParsingTest {
    @Test
    fun `chat response parses reply audit and override reasons`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "action": "send",
                  "reply": "视频就算了，打字聊吧",
                  "reply_id": "reply-1",
                  "reply_audit": {
                    "source": "model",
                    "reason": "model_reply",
                    "overrides": [
                      {
                        "rule": "media_boundary",
                        "reason": "voice_or_video_boundary",
                        "before": "好啊，发视频",
                        "after": "视频就算了，打字聊吧"
                      }
                    ]
                  }
                }
                """.trimIndent()
            )
        )
        server.start()
        try {
            val response = ApiService(server.url("/").toString()).chat(
                com.aaiagent.network.ChatRequest(
                    token = "token",
                    platform = "soul",
                    hostingMode = "full_auto",
                    requestId = "request-1",
                    contactId = "contact-1",
                    contactName = "甲",
                    messages = emptyList(),
                )
            ).response

            assertNotNull(response.replyAudit)
            assertEquals("model", response.replyAudit?.source)
            assertEquals("model_reply", response.replyAudit?.reason)
            assertEquals(1, response.replyAudit?.overrides?.size)
            assertEquals("media_boundary", response.replyAudit?.overrides?.first()?.rule)
            assertEquals(
                "voice_or_video_boundary",
                response.replyAudit?.overrides?.first()?.reason,
            )
        } finally {
            server.shutdown()
        }
    }
}
