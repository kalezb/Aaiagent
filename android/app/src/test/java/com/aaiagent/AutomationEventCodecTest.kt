package com.aaiagent

import com.aaiagent.engine.observability.AutomationEvent
import com.aaiagent.engine.observability.AutomationEventCodec
import com.aaiagent.engine.observability.AutomationPageKind
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationEventCodecTest {
    @Test
    fun `serializes page transaction fields`() {
        val json = AutomationEventCodec.toJson(
            AutomationEvent(
                eventId = "event-1",
                timestampMs = 1000L,
                monotonicMs = 2000L,
                traceId = "trace-1",
                transactionId = "tx-1",
                incidentId = "inc-1",
                platform = "soul",
                contactId = "contact-a",
                stage = "returning",
                event = "page_observed",
                action = "window_state",
                expectedState = "CONVERSATION_LIST",
                observedState = "PROFILE_PAGE",
                result = "anomaly",
                reason = "unexpected profile",
                pageKind = AutomationPageKind.PROFILE_PAGE,
                nodeFingerprint = "abc",
                unreadCount = 2,
                listFingerprint = "3|a|z",
                appVersion = "20261009-0600",
            )
        )

        assertTrue(json.contains("\"transactionId\":\"tx-1\""))
        assertTrue(json.contains("\"expectedState\":\"CONVERSATION_LIST\""))
        assertTrue(json.contains("\"observedState\":\"PROFILE_PAGE\""))
        assertTrue(json.contains("\"pageKind\":\"PROFILE_PAGE\""))
        assertTrue(json.contains("\"listFingerprint\":\"3|a|z\""))
    }
}
