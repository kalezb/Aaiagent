package com.aaiagent

import com.aaiagent.engine.observability.AccessibilityEventRecord
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityEventRecordTest {
    @Test
    fun `event line keeps millisecond times and escapes separators`() {
        val line = AccessibilityEventRecord(
            phase = "accessibility_event",
            wallTimeMs = 1_700_000_000_123L,
            bootTimeMs = 456_789L,
            eventTimeMs = 456_700L,
            eventType = "TYPE_WINDOW_STATE_CHANGED",
            packageName = "cn.soulapp.android",
            className = "ConversationActivity",
            sourceText = "你好|世界\n下一行",
        ).toLine()

        assertTrue(line.contains("1700000000123"))
        assertTrue(line.contains("456789"))
        assertTrue(line.contains("456700"))
        assertTrue(line.contains("你好\\p世界\\n下一行"))
        assertTrue(line.contains("TYPE_WINDOW_STATE_CHANGED"))
    }
}
