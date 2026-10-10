package com.aaiagent

import com.aaiagent.network.FishAudioRequestPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FishAudioRequestPolicyTest {
    @Test
    fun `normalizes supported speech request values`() {
        assertEquals("hello", FishAudioRequestPolicy.requireSpeechText("  hello  "))
        assertEquals("s2.1-pro-free", FishAudioRequestPolicy.resolveTtsModel("s2.1-pro-free"))
        assertEquals("mp3", FishAudioRequestPolicy.resolveFormat(null))
        assertEquals("transcribe-1-pro", FishAudioRequestPolicy.resolveAsrModel("transcribe-1-pro"))
    }

    @Test
    fun `rejects invalid speech request values`() {
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.requireSpeechText(" ")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.requireSpeechText("x".repeat(FishAudioRequestPolicy.MAX_TTS_CHARS + 1))
        }
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.resolveTtsModel("unknown")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.resolveFormat("aac")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.resolveAsrModel("whisper")
        }
    }

    @Test
    fun `bounds audio payloads before network calls`() {
        FishAudioRequestPolicy.requireAudio(byteArrayOf(1))
        FishAudioRequestPolicy.requireSpeechResult(byteArrayOf(1))

        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.requireAudio(ByteArray(0))
        }
        assertThrows(IllegalArgumentException::class.java) {
            FishAudioRequestPolicy.requireSpeechResult(ByteArray(0))
        }
    }
}
