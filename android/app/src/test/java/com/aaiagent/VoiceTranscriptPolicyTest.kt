package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.VoiceTranscriptPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTranscriptPolicyTest {
    private fun voice(content: String, transcript: String = "") =
        PlatformAdapter.ChatMessage(sender = "other", content = content, transcript = transcript)

    @Test
    fun `spoken text in either the content or the transcript field counts`() {
        assertTrue(VoiceTranscriptPolicy.hasSpokenText(listOf(voice("对方语音转文字：一点都不介意。"))))
        assertTrue(VoiceTranscriptPolicy.hasSpokenText(listOf(voice("[语音]", transcript = "一点都不介意。"))))
    }

    @Test
    fun `a bare placeholder means the transcript was lost`() {
        // 2026-10-07 真机（渔夫）：转写报告成功，但重读只有 [语音]，模型于是编了“没听清”。
        assertFalse(VoiceTranscriptPolicy.hasSpokenText(listOf(voice("[语音]"))))
        assertFalse(VoiceTranscriptPolicy.hasSpokenText(emptyList()))
    }

    @Test
    fun `rereads stop after the third try`() {
        assertTrue(VoiceTranscriptPolicy.shouldRetry(0))
        assertTrue(VoiceTranscriptPolicy.shouldRetry(1))
        assertFalse(VoiceTranscriptPolicy.shouldRetry(2))
    }
}
