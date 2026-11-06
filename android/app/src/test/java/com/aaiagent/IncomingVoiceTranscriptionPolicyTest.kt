package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.IncomingVoiceTranscriptionPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncomingVoiceTranscriptionPolicyTest {
    @Test
    fun `finds an untranscribed voice even when text is the latest message`() {
        val selection = selection(
            ChatMessage("other", "[语音]", type = "voice", identityKey = "voice-1"),
            ChatMessage("other", "你听得见吗", identityKey = "text-2"),
        )

        assertTrue(IncomingVoiceTranscriptionPolicy.hasMissingVoice(selection))
    }

    @Test
    fun `does not transcribe a voice that already has text`() {
        val selection = selection(
            ChatMessage(
                sender = "other",
                content = "[语音]",
                type = "voice",
                identityKey = "voice-1",
                transcript = "我到家了",
            ),
            ChatMessage("other", "你听得见吗", identityKey = "text-2"),
        )

        assertFalse(IncomingVoiceTranscriptionPolicy.hasMissingVoice(selection))
    }

    private fun selection(vararg messages: ChatMessage): IncomingMessageBatch.Selection {
        val list = messages.toList()
        return IncomingMessageBatch.Selection(
            incoming = list,
            latestIncoming = list.last(),
            mediaTarget = list.lastOrNull { it.type == "voice" },
            textTarget = list.lastOrNull { it.type == "text" },
            preferTextOnly = true,
        )
    }
}
