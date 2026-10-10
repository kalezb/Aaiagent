package com.aaiagent

import com.aaiagent.engine.observability.AutomationAnomalyDetector
import com.aaiagent.engine.observability.AutomationEvent
import com.aaiagent.engine.observability.AutomationPageKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutomationAnomalyDetectorTest {
    @Test
    fun `reports profile page shortly after a reply delivery`() {
        val detector = AutomationAnomalyDetector()
        assertNull(
            detector.observe(
                AutomationEvent(
                    timestampMs = 1_000L,
                    event = "delivery_finished",
                    stage = "sending",
                    result = "complete",
                )
            )
        )

        val anomaly = detector.observe(
            AutomationEvent(
                timestampMs = 1_500L,
                event = "page_observed",
                pageKind = AutomationPageKind.PROFILE_PAGE,
                contactId = "contact-a",
            )
        )

        assertEquals("UnexpectedProfilePageAfterReply", anomaly?.type)
    }

    @Test
    fun `ignores profile page after the reply context expired`() {
        val detector = AutomationAnomalyDetector()
        detector.observe(
            AutomationEvent(
                timestampMs = 1_000L,
                event = "delivery_finished",
                stage = "sending",
            )
        )

        val anomaly = detector.observe(
            AutomationEvent(
                timestampMs = 20_000L,
                event = "page_observed",
                pageKind = AutomationPageKind.PROFILE_PAGE,
            )
        )

        assertNull(anomaly)
    }

    @Test
    fun `reports repeated identical list scans with no unread`() {
        val detector = AutomationAnomalyDetector(
            refreshWindowMs = 5_000L,
            sameFingerprintThreshold = 3,
        )
        val events = (0..2).map { index ->
            AutomationEvent(
                timestampMs = 1_000L + index * 500L,
                event = "list_scan_finished",
                stage = "list_scan",
                listFingerprint = "same-page",
                unreadCount = 0,
            )
        }

        assertNull(detector.observe(events[0]))
        assertNull(detector.observe(events[1]))
        val anomaly = detector.observe(events[2])
        assertEquals("ConversationListRefreshStorm", anomaly?.type)
    }

    @Test
    fun `does not report refresh storm when unread exists`() {
        val detector = AutomationAnomalyDetector(
            refreshWindowMs = 5_000L,
            sameFingerprintThreshold = 3,
        )
        val events = (0..2).map { index ->
            AutomationEvent(
                timestampMs = 1_000L + index * 500L,
                event = "list_scan_finished",
                stage = "list_scan",
                listFingerprint = "same-page",
                unreadCount = 1,
            )
        }

        assertNull(detector.observe(events[0]))
        assertNull(detector.observe(events[1]))
        assertNull(detector.observe(events[2]))
    }

    @Test
    fun `reports content change feedback loop`() {
        val detector = AutomationAnomalyDetector()
        var anomaly: com.aaiagent.engine.observability.AutomationAnomaly? = null
        repeat(20) { index ->
            anomaly = detector.observe(
                AutomationEvent(
                    timestampMs = 1_000L + index * 80L,
                    event = "content_changed",
                    stage = "content_change",
                    action = "idle_wake",
                    platform = "soul",
                )
            )
        }

        assertEquals("ConversationListRefreshStorm", anomaly?.type)
    }
}
