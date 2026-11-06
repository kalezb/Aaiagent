package com.aaiagent

import com.aaiagent.engine.ConversationMessageLedger
import com.aaiagent.engine.SyncSnapshotItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationMessageLedgerTest {
    @Test
    fun `first baseline assigns positions but does not sync old history as new`() {
        val result = ConversationMessageLedger.reconcile(
            previous = emptyList(),
            current = listOf(item("user", "你好"), item("assistant", "在的")),
            hasEstablishedBaseline = false,
            nextOrdinal = 0L,
        )

        assertTrue(result.newIndexes.isEmpty())
        assertEquals("user\u001f你好", result.items[0].stableKey)
        assertEquals(1L, result.items[0].ledgerOrdinal)
        assertEquals(2L, result.items[1].ledgerOrdinal)
        assertFalse(result.ambiguous)
    }

    @Test
    fun `re-reading the same page does not create a new message`() {
        val first = ConversationMessageLedger.reconcile(
            previous = emptyList(),
            current = listOf(item("user", "在吗"), item("assistant", "在")),
            hasEstablishedBaseline = false,
            nextOrdinal = 0L,
        )

        val second = ConversationMessageLedger.reconcile(
            previous = first.items,
            current = listOf(item("user", "在吗"), item("assistant", "在")),
            hasEstablishedBaseline = true,
            nextOrdinal = first.nextOrdinal,
        )

        assertTrue(second.newIndexes.isEmpty())
        assertEquals(2, second.matchedCount)
        assertEquals(first.items.map { it.stableKey }, second.items.map { it.stableKey })
    }

    @Test
    fun `same words after a reply get a different conversation position`() {
        val previous = listOf(
            item("user", "在吗"),
            item("assistant", "在"),
        )
        val result = ConversationMessageLedger.reconcile(
            previous = previous,
            current = previous + item("user", "在吗"),
            hasEstablishedBaseline = true,
            nextOrdinal = 2L,
        )

        assertEquals(listOf(2), result.newIndexes)
        assertEquals("user\u001f在吗", result.items[0].stableKey)
        assertEquals("user\u001f在吗#occ:2", result.items[2].stableKey)
        assertEquals(3L, result.items[2].ledgerOrdinal)
    }

    @Test
    fun `shifted visible window keeps old positions and only appends the tail`() {
        val previous = listOf(
            item("user", "一"),
            item("user", "二"),
            item("user", "三"),
        )
        val result = ConversationMessageLedger.reconcile(
            previous = previous,
            current = listOf(
                item("user", "二"),
                item("user", "三"),
                item("user", "四"),
            ),
            hasEstablishedBaseline = true,
            nextOrdinal = 3L,
        )

        assertEquals(listOf(2), result.newIndexes)
        assertEquals(listOf(null, null, null), previous.map { it.contentKey })
        assertEquals("user\u001f三", result.items[1].stableKey)
        assertEquals("user\u001f四", result.items[2].stableKey)
    }

    @Test
    fun `no overlap stops instead of guessing missing messages`() {
        val result = ConversationMessageLedger.reconcile(
            previous = listOf(item("user", "旧消息")),
            current = listOf(item("user", "完全接不上")),
            hasEstablishedBaseline = true,
            nextOrdinal = 7L,
        )

        assertTrue(result.ambiguous)
        assertTrue(result.newIndexes.isEmpty())
        assertEquals(7L, result.nextOrdinal)
    }

    @Test
    fun `an older visible window cannot replace the known latest messages`() {
        val previous = listOf(
            item("user", "一"),
            item("assistant", "二"),
            item("user", "最新一条"),
        )
        val result = ConversationMessageLedger.reconcile(
            previous = previous,
            current = listOf(
                item("user", "一"),
                item("assistant", "二"),
            ),
            hasEstablishedBaseline = true,
            nextOrdinal = 3L,
        )

        assertTrue(result.ambiguous)
        assertTrue(result.newIndexes.isEmpty())
    }

    private fun item(role: String, content: String): SyncSnapshotItem {
        return SyncSnapshotItem(role = role, content = content)
    }
}
