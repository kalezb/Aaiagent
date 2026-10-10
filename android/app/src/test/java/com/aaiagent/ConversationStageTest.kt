package com.aaiagent

import com.aaiagent.engine.ConversationStage
import com.aaiagent.engine.RelationshipOrigin
import com.aaiagent.engine.SoulConversationStagePolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class ConversationStageTest {
    @Test
    fun `list page identifies how the contact was introduced`() {
        assertEquals(
            RelationshipOrigin.MATCH,
            SoulConversationStagePolicy.classifyListOrigin("匹配", false),
        )
        assertEquals(
            RelationshipOrigin.SERENDIPITY,
            SoulConversationStagePolicy.classifyListOrigin("奇遇铃", false),
        )
        assertEquals(
            RelationshipOrigin.SOULMATE,
            SoulConversationStagePolicy.classifyListOrigin("", true),
        )
        assertEquals(
            RelationshipOrigin.UNKNOWN,
            SoulConversationStagePolicy.classifyListOrigin("", false),
        )
    }

    @Test
    fun `soulmate marker outranks every other chat marker`() {
        assertEquals(
            ConversationStage.SOULMATE,
            SoulConversationStagePolicy.classifyChatStage(
                hasSoulmateMarker = true,
                hasHeartMarker = true,
                hasProfileCard = true,
                outgoingCount = 12,
                visibleMessageCount = 30,
            ),
        )
    }

    @Test
    fun `heart stage means the relationship has already moved past the first contact`() {
        assertEquals(
            ConversationStage.FAMILIAR,
            SoulConversationStagePolicy.classifyChatStage(
                hasSoulmateMarker = false,
                hasHeartMarker = true,
                hasProfileCard = true,
                outgoingCount = 0,
                visibleMessageCount = 2,
            ),
        )
    }

    @Test
    fun `profile card with no outgoing reply is a true first contact`() {
        assertEquals(
            ConversationStage.FIRST_CONTACT,
            SoulConversationStagePolicy.classifyChatStage(
                hasSoulmateMarker = false,
                hasHeartMarker = false,
                hasProfileCard = true,
                outgoingCount = 0,
                visibleMessageCount = 1,
            ),
        )
    }

    @Test
    fun `a previous outgoing reply makes an unmarked chat continuing`() {
        assertEquals(
            ConversationStage.CONTINUING,
            SoulConversationStagePolicy.classifyChatStage(
                hasSoulmateMarker = false,
                hasHeartMarker = false,
                hasProfileCard = true,
                outgoingCount = 1,
                visibleMessageCount = 3,
            ),
        )
    }

    @Test
    fun `empty or unknown chat pages stay unknown`() {
        assertEquals(
            ConversationStage.UNKNOWN,
            SoulConversationStagePolicy.classifyChatStage(
                hasSoulmateMarker = false,
                hasHeartMarker = false,
                hasProfileCard = false,
                outgoingCount = 0,
                visibleMessageCount = 0,
            ),
        )
    }
}
