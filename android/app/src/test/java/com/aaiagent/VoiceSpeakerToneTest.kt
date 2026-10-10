package com.aaiagent

import com.aaiagent.engine.VoiceSpeakerPlayback
import com.aaiagent.engine.VoiceSpeakerTone
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 外放的声音整形。
 *
 * 这种东西错了不会崩、只会"听着不对"，所以每个环节都用可量化的性质钉住：
 * 高通必须真的砍掉低频、压限必须真的缩小动态范围、整条链必须不削波。
 */
class VoiceSpeakerToneTest {

    private val rate = 16_000

    /** 生成一段正弦波 PCM。 */
    private fun tone(frequencyHz: Double, frames: Int, amplitude: Int): ByteArray {
        val out = ByteArray(frames * 2)
        for (frame in 0 until frames) {
            val value = (amplitude * sin(2.0 * PI * frequencyHz * frame / rate)).roundToInt()
            val clamped = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[frame * 2] = (clamped and 0xFF).toByte()
            out[frame * 2 + 1] = ((clamped shr 8) and 0xFF).toByte()
        }
        return out
    }

    private fun silent(frames: Int) = ByteArray(frames * 2)

    private fun peak(pcm: ByteArray) = VoiceSpeakerPlayback.peakOf(pcm)

    // ---- 高通：砍掉小喇叭放不出来的低频 ----

    @Test
    fun `the high pass really removes low frequencies`() {
        // 200Hz 低于高通截止（280Hz），应该被明显压掉。
        val low = tone(200.0, 8_000, 12_000)
        val filtered = VoiceSpeakerTone.applyEq(low, rate)
        // 掐掉开头（滤波器需要一点时间稳定），只看后面。
        val tail = filtered.copyOfRange(2_000 * 2, filtered.size)
        assertTrue("200Hz 应该被压掉一半以上", peak(tail) < peak(low) / 2)
    }

    @Test
    fun `the high pass keeps the speech band`() {
        // 2kHz 在人声清晰度区间，而且正好是提升点 —— 不该被削。
        val mid = tone(2_000.0, 8_000, 8_000)
        val filtered = VoiceSpeakerTone.applyEq(mid, rate)
        val tail = filtered.copyOfRange(2_000 * 2, filtered.size)
        assertTrue("2kHz 不该被砍掉", peak(tail) > peak(mid) / 2)
    }

    @Test
    fun `pure silence stays silent through the eq`() {
        val out = VoiceSpeakerTone.applyEq(silent(4_000), rate)
        assertEquals(0, peak(out))
    }

    // ---- 压限：把音量压平 ----

    @Test
    fun `the compressor shrinks the dynamic range`() {
        // 前半段很响、后半段很轻，压限之后两段的差距应该变小。
        val loud = tone(500.0, 4_000, 20_000)
        val quiet = tone(500.0, 4_000, 3_000)
        val mixed = loud + quiet

        val compressed = VoiceSpeakerTone.compress(mixed, rate)
        val loudPeak = peak(compressed.copyOfRange(2_000 * 2, 3_600 * 2))
        val quietPeak = peak(compressed.copyOfRange(6_000 * 2, 7_600 * 2))

        val before = 20_000.0 / 3_000.0
        val after = loudPeak.toDouble() / quietPeak.toDouble().coerceAtLeast(1.0)
        assertTrue("动态范围应该被压小（压前 ${"%.1f".format(before)}，压后 ${"%.1f".format(after)}）", after < before)
    }

    @Test
    fun `a signal below the threshold passes through untouched`() {
        // 阈值为 -18dBFS（约 0.126 满幅）。远低于它的信号不该被动。
        val tiny = tone(500.0, 4_000, 1_000)
        val out = VoiceSpeakerTone.compress(tiny, rate)
        assertTrue("轻信号不该被压", abs(peak(out) - peak(tiny)) <= 2)
    }

    @Test
    fun `compressing silence stays silent`() {
        assertEquals(0, peak(VoiceSpeakerTone.compress(silent(4_000), rate)))
    }

    // ---- 整条链 ----

    @Test
    fun `the full chain never clips`() {
        // 满幅输入 + 提升 → 最后一步归一化必须把峰值压回安全范围。
        val loud = tone(2_000.0, 8_000, Short.MAX_VALUE.toInt())
        val out = VoiceSpeakerTone.prepare(loud, rate)
        assertTrue("不能削波", peak(out) <= Short.MAX_VALUE.toInt())
        assertTrue(
            "也不该低太多（归一化要到目标峰值附近）",
            peak(out) > (Short.MAX_VALUE * VoiceSpeakerPlayback.TARGET_PEAK_RATIO * 0.5).toInt()
        )
    }

    @Test
    fun `the full chain lifts a quiet voice`() {
        // 外放最怕配音本身太轻 —— 整形之后应该明显更响。
        val quiet = tone(1_500.0, 8_000, 2_500)
        val out = VoiceSpeakerTone.prepare(quiet, rate)
        assertTrue("轻的配音应该被抬起来", peak(out) > peak(quiet) * 2)
    }

    @Test
    fun `the full chain keeps silence silent`() {
        assertEquals(0, peak(VoiceSpeakerTone.prepare(silent(4_000), rate)))
    }

    @Test
    fun `degenerate input is returned untouched instead of crashing`() {
        val empty = ByteArray(0)
        assertEquals(0, VoiceSpeakerTone.prepare(empty, rate).size)
        val twoBytes = byteArrayOf(1, 2)
        assertEquals(2, VoiceSpeakerTone.prepare(twoBytes, rate).size)
        // 采样率非法时也不能崩。
        assertEquals(4, VoiceSpeakerTone.prepare(ByteArray(4), 0).size)
    }

    @Test
    fun `the eq parameters stay inside what a phone speaker can reproduce`() {
        // 截止频率要高于小喇叭的下限（否则切了也没用），提升点要落在人声区。
        assertTrue(VoiceSpeakerTone.HIGH_PASS_HZ in 150.0..400.0)
        assertTrue(VoiceSpeakerTone.PRESENCE_HZ in 1_000.0..3_000.0)
        assertTrue(VoiceSpeakerTone.CLARITY_HZ in 3_000.0..5_000.0)
        // 压限要温和 —— 压太狠会听出"喘气"感，比不压还假。
        assertTrue(VoiceSpeakerTone.COMPRESSOR_RATIO in 1.5..4.0)
        assertTrue(VoiceSpeakerTone.COMPRESSOR_ATTACK_MS in 5.0..30.0)
        assertTrue(VoiceSpeakerTone.COMPRESSOR_RELEASE_MS in 80.0..300.0)
    }
}
