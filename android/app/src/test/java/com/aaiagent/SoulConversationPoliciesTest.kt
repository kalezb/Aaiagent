package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.work.SoulContactIdentityPolicy
import com.aaiagent.engine.work.SoulRiskOverlayPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulConversationPoliciesTest {
    @Test
    fun `unique contact keeps a stable name id and can open`() {
        val identity = SoulContactIdentityPolicy.identity(
            conversation = conversation(name = "苏棠", preview = "晚上好"),
            duplicateNameCount = 1,
        )

        assertEquals("soul-name:苏棠", identity.stableId)
        assertEquals("soul:soul-name:苏棠", identity.key)
        assertEquals(0.7f, identity.confidence, 0.0001f)
        assertTrue(SoulContactIdentityPolicy.canOpenWithoutRisk(identity))
    }

    @Test
    fun `duplicate names get separate ids but can never be opened automatically`() {
        val first = SoulContactIdentityPolicy.identity(
            conversation = conversation(name = "苏棠", preview = "第一页的预览"),
            duplicateNameCount = 2,
        )
        val second = SoulContactIdentityPolicy.identity(
            conversation = conversation(name = "苏棠", preview = "第二页的预览", pageIndex = 1),
            duplicateNameCount = 2,
        )

        assertNotEquals(first.key, second.key)
        assertTrue(first.stableId.startsWith("soul-ambiguous:苏棠:0:"))
        assertTrue(second.stableId.startsWith("soul-ambiguous:苏棠:1:"))
        assertFalse(SoulContactIdentityPolicy.canOpenWithoutRisk(first))
        assertFalse(SoulContactIdentityPolicy.canOpenWithoutRisk(second))
    }

    @Test
    fun `name compared for chat verification removes invisible decorations`() {
        assertTrue(
            SoulContactIdentityPolicy.exactNameMatches(
                expected = "  苏棠 ",
                actual = "苏棠\u200B 在线",
            )
        )
        assertFalse(
            SoulContactIdentityPolicy.exactNameMatches(
                expected = "苏棠",
                actual = "苏棠的闺蜜",
            )
        )
    }

    @Test
    fun `post risk dialog needs all three safety markers`() {
        assertTrue(
            SoulRiskOverlayPolicy.isPostRiskDialog(
                visibleTexts = listOf(
                    SoulRiskOverlayPolicy.POST_RISK_TEXT,
                    SoulRiskOverlayPolicy.UNLOCK_TEXT,
                    SoulRiskOverlayPolicy.CLOSE_TEXT,
                )
            )
        )
        assertFalse(
            SoulRiskOverlayPolicy.isPostRiskDialog(
                visibleTexts = listOf(
                    SoulRiskOverlayPolicy.POST_RISK_TEXT,
                    SoulRiskOverlayPolicy.CLOSE_TEXT,
                )
            )
        )
    }

    @Test
    fun `post risk dialog can be found in content descriptions too`() {
        assertTrue(
            SoulRiskOverlayPolicy.isPostRiskDialog(
                visibleTexts = emptyList(),
                contentDescriptions = listOf(
                    SoulRiskOverlayPolicy.POST_RISK_TEXT,
                    SoulRiskOverlayPolicy.UNLOCK_TEXT,
                    SoulRiskOverlayPolicy.CLOSE_TEXT,
                ),
            )
        )
    }

    private fun conversation(
        name: String,
        preview: String,
        pageIndex: Int = 0,
    ) = PlatformAdapter.ConversationInfo(
        contactId = "",
        contactName = name,
        preview = preview,
        hasUnread = true,
        pageIndex = pageIndex,
    )
}
