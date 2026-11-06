package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.ConversationMessageLedger
import com.aaiagent.engine.SoulConversationWindowPolicy
import com.aaiagent.engine.SyncSnapshotItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class SoulConversationWindowPolicyTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val nowMs = ZonedDateTime.of(2026, 10, 17, 10, 0, 0, 0, zone)
        .toInstant()
        .toEpochMilli()

    @Test
    fun `visible new incoming message can append after old window`() {
        val canAppend = SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
            previous = listOf(SyncSnapshotItem("user", "旧消息", createdAt = 100L)),
            messages = listOf(ChatMessage("other", "早呀，周末愉快")),
            listPreview = "早呀，周末愉快",
            listTimeText = "09:45",
            nowMs = nowMs,
        )

        assertTrue(canAppend)
    }

    @Test
    fun `preview mismatch or own message still stops`() {
        val previous = listOf(SyncSnapshotItem("user", "旧消息", createdAt = 100L))
        assertFalse(
            SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
                previous = previous,
                messages = listOf(ChatMessage("other", "新消息")),
                listPreview = "另一条",
                listTimeText = "09:45",
                nowMs = nowMs,
            )
        )
        assertFalse(
            SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
                previous = previous,
                messages = listOf(ChatMessage("self", "新消息")),
                listPreview = "新消息",
                listTimeText = "09:45",
                nowMs = nowMs,
            )
        )
    }

    @Test
    fun `same words only append when the list time advanced`() {
        val previous = listOf(
            SyncSnapshotItem(
                role = "user",
                content = "哈喽",
                createdAt = ZonedDateTime.of(2026, 10, 17, 9, 30, 0, 0, zone)
                    .toInstant()
                    .epochSecond,
            )
        )
        val message = listOf(ChatMessage("other", "哈喽"))

        assertFalse(
            SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
                previous = previous,
                messages = message,
                listPreview = "哈喽",
                listTimeText = "09:30",
                nowMs = nowMs,
            )
        )
        assertTrue(
            SoulConversationWindowPolicy.canAppendLatestOutsideWindow(
                previous = previous,
                messages = message,
                listPreview = "哈喽",
                listTimeText = "09:45",
                nowMs = nowMs,
            )
        )
    }

    @Test
    fun `ledger appends the visible latest with a new position`() {
        val previous = listOf(SyncSnapshotItem("user", "旧消息", createdAt = 100L))
        val latest = SyncSnapshotItem("user", "早呀，周末愉快", createdAt = 200L)

        val result = ConversationMessageLedger.appendVisibleLatest(
            previous = previous,
            current = listOf(latest),
            nextOrdinal = 7L,
        )

        assertEquals(listOf(1), result.newIndexes)
        assertEquals(8L, result.items.last().ledgerOrdinal)
        assertEquals("user\u001f早呀，周末愉快", result.items.last().stableKey)
    }
}
