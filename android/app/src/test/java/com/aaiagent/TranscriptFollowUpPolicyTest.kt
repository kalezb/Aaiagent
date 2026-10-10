package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.TranscriptFollowUpPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TranscriptFollowUpPolicyTest {
    @Test
    fun `finds a later voice transcript that has not been answered`() {
        val voice = ChatMessage(
            sender = "other",
            content = "对方语音转文字：你睡了吗",
            type = "voice",
            transcript = "你睡了吗",
        )
        val reply = ChatMessage("self", "睡了", "text")

        assertEquals(
            voice,
            TranscriptFollowUpPolicy.find(listOf(voice, reply)) { false },
        )
    }

    @Test
    fun `does not answer the same transcript twice`() {
        val voice = ChatMessage(
            sender = "other",
            content = "对方语音转文字：你睡了吗",
            type = "voice",
            transcript = "你睡了吗",
        )

        assertNull(TranscriptFollowUpPolicy.find(listOf(voice)) { true })
    }
}
