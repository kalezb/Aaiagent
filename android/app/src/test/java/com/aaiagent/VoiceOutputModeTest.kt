package com.aaiagent

import com.aaiagent.adapter.SoulVoiceRecordPolicy
import com.aaiagent.engine.VoiceOutput
import com.aaiagent.engine.VoiceOutputMode
import com.aaiagent.engine.VoiceSpeakerPlayback
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 配音送进录音的两种方式（用户 2026-10-06 定的）：
 * **root 过的走注入，没 root 的走外放**，另外允许手动覆盖。
 */
class VoiceOutputModeTest {

    // ---- 自动判断：以"注入模块还活着吗"为准 ----

    @Test
    fun `auto mode picks injection when the module is running`() {
        assertEquals(VoiceOutput.INJECT, VoiceOutputMode.resolve(null, moduleAlive = true))
        assertEquals(VoiceOutput.INJECT, VoiceOutputMode.resolve("auto", moduleAlive = true))
    }

    @Test
    fun `auto mode falls back to the speaker when there is no module`() {
        // 没 root 的手机上根本没有注入模块 —— 这就是它该走外放的原因。
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve(null, moduleAlive = false))
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve("auto", moduleAlive = false))
    }

    // ---- 手动覆盖：在 root 手机上测外放时用得到 ----

    @Test
    fun `manual injection wins even without a module`() {
        assertEquals(VoiceOutput.INJECT, VoiceOutputMode.resolve("inject", moduleAlive = false))
    }

    @Test
    fun `manual speaker wins even when the module is running`() {
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve("speaker", moduleAlive = true))
    }

    @Test
    fun `unknown or padded config values fall back to auto`() {
        // 写错了、多了空格、大小写不对，都不该让语音整个失效。
        assertEquals(VoiceOutput.INJECT, VoiceOutputMode.resolve("  INJECT ", moduleAlive = true))
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve(" Speaker ", moduleAlive = false))
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve("", moduleAlive = false))
        assertEquals(VoiceOutput.SPEAKER, VoiceOutputMode.resolve("随便写的", moduleAlive = false))
    }

    // ---- 外放要录得比配音长一点 ----

    @Test
    fun `speaker mode records longer than the audio so the start is not clipped`() {
        // 扬声器响起来、声音传到麦克风都需要时间，不留这段余量对方听到的开头会缺字。
        assertEquals(
            5_000L + VoiceOutputMode.SPEAKER_EXTRA_MS,
            VoiceOutputMode.speakerRecordDurationMs(5_000L)
        )
    }

    /**
     * 用户定的：配音放完之后，尾部静音**总计 1 秒**
     * （先定 1.5 秒，随后改成 1 秒）。
     *
     * 这条等式把三个余量钉在一起（外放额外 250 + 录音收尾 400 + 350），
     * 改任何一个不同步改其他的，这里就会红。
     */
    @Test
    fun `the total trailing silence after the audio stays at the agreed one second`() {
        val audio = 5_000L
        val recordedTargetMs = SoulVoiceRecordPolicy.recordDurationMs(
            VoiceOutputMode.speakerRecordDurationMs(audio)
        )
        assertEquals(
            audio + VoiceOutputMode.SPEAKER_TAIL_SILENCE_TARGET_MS,
            recordedTargetMs
        )
        assertEquals(1_000L, VoiceOutputMode.SPEAKER_TAIL_SILENCE_TARGET_MS)
    }

    @Test
    fun `a non positive duration stays zero instead of turning into headroom`() {
        assertEquals(0L, VoiceOutputMode.speakerRecordDurationMs(0L))
        assertEquals(0L, VoiceOutputMode.speakerRecordDurationMs(-100L))
    }

    // ---- 音量：只读不调 ----

    @Test
    fun `a low media volume is flagged but never adjusted`() {
        assertEquals(true, VoiceSpeakerPlayback.isVolumeTooLow(0))
        assertEquals(true, VoiceSpeakerPlayback.isVolumeTooLow(29))
        assertEquals(false, VoiceSpeakerPlayback.isVolumeTooLow(30))
        assertEquals(false, VoiceSpeakerPlayback.isVolumeTooLow(100))
    }

    @Test
    fun `an unreadable volume is not treated as too low`() {
        // 读不到音量（-1）时不该乱报警告，更不该去动它。
        assertEquals(false, VoiceSpeakerPlayback.isVolumeTooLow(-1))
    }

    @Test
    fun `reading the volume without an audio manager is safe`() {
        // 用户明确要求音量由他自己控制 —— 这里只读，读不到就返回 -1。
        assertEquals(-1, VoiceSpeakerPlayback.mediaVolumePercent(null))
    }

    // ---- 音量低到"必然录出没声音的语音"时就别用外放 ----

    /**
     * 真机事故（2026-10-06 19:46）：媒体音量 0，播放 completed=true 但一声没出，
     * 录进去的是空气 —— 对方点开一片安静。**硬发一条哑的比不发还糟。**
     */
    @Test
    fun `silent media volume must not be used for the speaker`() {
        assertEquals(false, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(0))
        assertEquals(false, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(1))
        assertEquals(false, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(9))
    }

    @Test
    fun `a usable volume is allowed through`() {
        assertEquals(true, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(10))
        assertEquals(true, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(30))
        assertEquals(true, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(100))
    }

    @Test
    fun `an unreadable volume is not treated as unusable`() {
        // 读不到就别把整条语音能力关掉 —— 宁可按当前情况试一次。
        assertEquals(true, VoiceSpeakerPlayback.isVolumeUsableForSpeaker(-1))
    }

    // ---- 音质：数字增益归一化 ----

    /**
     * 配音本身太轻时，Soul 的麦克风自动增益会把底噪一起放大 —— 这就是"电流麦"。
     * 先把配音数字放大，送出去的信号变强，麦克风就不必拉那么猛。
     */
    @Test
    fun `a quiet voice clip is boosted towards full scale`() {
        // 峰值只有满幅的 1/8，应该被放大到接近满幅。
        val quiet = pcm16(ShortArray(100) { if (it % 2 == 0) 4_000 else -4_000 })
        val loud = VoiceSpeakerPlayback.normalizePcm16(quiet)
        val peak = peakOf(loud)
        assertEquals(true, peak > 3_000 * 4)
        assertEquals(true, peak <= (Short.MAX_VALUE * VoiceSpeakerPlayback.TARGET_PEAK_RATIO).toInt() + 1)
    }

    @Test
    fun `an already loud clip is left alone`() {
        // 已经接近满幅就别再放大 —— 削波产生的破音比轻一点糟得多。
        val loud = pcm16(ShortArray(100) { if (it % 2 == 0) 32_000 else -32_000 })
        assertEquals(true, VoiceSpeakerPlayback.normalizePcm16(loud) === loud)
    }

    @Test
    fun `silence stays silence and is never turned into noise`() {
        val silence = ByteArray(200)
        assertEquals(true, VoiceSpeakerPlayback.normalizePcm16(silence) === silence)
    }

    @Test
    fun `normalising never clips`() {
        // 极轻的信号也不能被放大到超出 16 位范围。
        val tiny = pcm16(ShortArray(50) { if (it % 2 == 0) 3 else -3 })
        val peak = peakOf(VoiceSpeakerPlayback.normalizePcm16(tiny))
        assertEquals(true, peak <= Short.MAX_VALUE.toInt())
    }

    // ---- 音质：重采样到 48kHz ----

    @Test
    fun `sixteen kilohertz audio is upsampled to the playback rate`() {
        // 16k → 48k，长度应该变成三倍（每帧两个字节）。
        val frames = 160
        val input = ByteArray(frames * 2)
        val output = VoiceSpeakerPlayback.resamplePcm16(input, 16_000, 48_000)
        assertEquals(frames * 3 * 2, output.size)
    }

    @Test
    fun `resampling to the same rate changes nothing`() {
        val input = ByteArray(64)
        assertEquals(true, VoiceSpeakerPlayback.resamplePcm16(input, 48_000, 48_000) === input)
    }

    @Test
    fun `the playback rate is the phone friendly one`() {
        assertEquals(48_000, VoiceSpeakerPlayback.PLAYBACK_SAMPLE_RATE)
    }

    private fun pcm16(samples: ShortArray): ByteArray {
        val out = ByteArray(samples.size * 2)
        samples.forEachIndexed { index, value ->
            out[index * 2] = (value.toInt() and 0xFF).toByte()
            out[index * 2 + 1] = ((value.toInt() shr 8) and 0xFF).toByte()
        }
        return out
    }

    private fun peakOf(pcm: ByteArray): Int {
        var peak = 0
        var index = 0
        while (index + 1 < pcm.size) {
            val low = pcm[index].toInt() and 0xFF
            val high = pcm[index + 1].toInt()
            val sample = (high shl 8) or low
            val magnitude = if (sample < 0) -sample else sample
            if (magnitude > peak) peak = magnitude
            index += 2
        }
        return peak
    }
}
