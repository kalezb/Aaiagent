package com.aaiagent

import com.aaiagent.engine.AudioPcmPreparer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException

/**
 * 音频解码 / 重采样 / 时长计算。
 *
 * 只测纯计算那部分（不碰 MediaCodec）—— 这类处理最容易出静音、变调、爆音
 * 这种"跑起来不报错但声音不对"的隐蔽问题，必须靠断言钉住。
 */
class AudioPcmPreparerTest {

    /** 造一个最小可用的 WAV。 */
    private fun wav(rate: Int, channels: Int, bits: Int, samples: IntArray): ByteArray {
        val bytesPerSample = if (bits <= 8) 1 else 2
        val dataSize = samples.size * bytesPerSample
        val out = ByteArrayOutputStream()
        fun ascii(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun le16(v: Int) {
            out.write(v and 0xFF)
            out.write((v shr 8) and 0xFF)
        }
        fun le32(v: Int) {
            le16(v and 0xFFFF)
            le16((v shr 16) and 0xFFFF)
        }
        ascii("RIFF"); le32(36 + dataSize); ascii("WAVE")
        ascii("fmt "); le32(16)
        le16(1); le16(channels); le32(rate)
        le32(rate * channels * bytesPerSample)
        le16(channels * bytesPerSample); le16(bits)
        ascii("data"); le32(dataSize)
        samples.forEach { s ->
            if (bits <= 8) {
                out.write(s and 0xFF)
            } else {
                out.write(s and 0xFF)
                out.write((s shr 8) and 0xFF)
            }
        }
        return out.toByteArray()
    }

    private fun readShort(bytes: ByteArray, offset: Int): Int {
        val lo = bytes[offset].toInt() and 0xFF
        val hi = bytes[offset + 1].toInt() and 0xFF
        return (lo or (hi shl 8)).toShort().toInt()
    }

    private fun writeShort(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value and 0xFF).toByte()
        bytes[offset + 1] = ((value shr 8) and 0xFF).toByte()
    }

    // ---- 解析 WAV ----

    @Test
    fun `parses rate channels and keeps every sample`() {
        val decoded = AudioPcmPreparer.parseWav(
            wav(16_000, 1, 16, intArrayOf(0, 1000, -1000, 32767))
        )
        assertEquals(16_000, decoded.rate)
        assertEquals(1, decoded.channels)
        assertEquals(8, decoded.pcm.size)
        assertEquals(1000, readShort(decoded.pcm, 2))
        assertEquals(-1000, readShort(decoded.pcm, 4))
        assertEquals(32767, readShort(decoded.pcm, 6))
    }

    @Test
    fun `stereo is reported as stereo`() {
        val decoded = AudioPcmPreparer.parseWav(wav(44_100, 2, 16, intArrayOf(1, 2, 3, 4)))
        assertEquals(44_100, decoded.rate)
        assertEquals(2, decoded.channels)
        assertEquals(8, decoded.pcm.size)
    }

    @Test
    fun `eight bit samples are widened to sixteen`() {
        val decoded = AudioPcmPreparer.parseWav(wav(8_000, 1, 8, intArrayOf(128, 0, 255)))
        assertEquals(6, decoded.pcm.size)
        assertEquals(0, readShort(decoded.pcm, 0))
        assertEquals(-128, readShort(decoded.pcm, 2))
        assertEquals(127, readShort(decoded.pcm, 4))
    }

    @Test(expected = IOException::class)
    fun `non wav input is rejected instead of silently decoded`() {
        AudioPcmPreparer.parseWav(ByteArray(100))
    }

    @Test(expected = IOException::class)
    fun `wav without a data chunk is rejected`() {
        val out = ByteArrayOutputStream()
        fun ascii(s: String) = out.write(s.toByteArray(Charsets.US_ASCII))
        fun le32(v: Int) {
            out.write(v and 0xFF); out.write((v shr 8) and 0xFF)
            out.write((v shr 16) and 0xFF); out.write((v shr 24) and 0xFF)
        }
        ascii("RIFF"); le32(36); ascii("WAVE")
        ascii("fmt "); le32(16)
        out.write(ByteArray(16))
        AudioPcmPreparer.parseWav(out.toByteArray())
    }

    // ---- 重采样 ----

    @Test
    fun `same format is returned untouched`() {
        val pcm = AudioPcmPreparer.parseWav(wav(16_000, 1, 16, intArrayOf(1, 2, 3, 4))).pcm
        assertArrayEquals(pcm, AudioPcmPreparer.resample(pcm, 1, 16_000, 16_000, 1))
    }

    @Test
    fun `downsampling keeps the frame count proportional`() {
        val pcm = ByteArray(441 * 2)
        assertEquals(160, AudioPcmPreparer.resample(pcm, 1, 44_100, 16_000, 1).size / 2)
    }

    @Test
    fun `a constant signal stays constant after resampling`() {
        val pcm = ByteArray(200 * 2)
        for (i in 0 until 200) writeShort(pcm, i * 2, 1000)
        val out = AudioPcmPreparer.resample(pcm, 1, 44_100, 16_000, 1)
        val frames = out.size / 2
        assertEquals(true, frames > 0)
        for (i in 0 until frames) {
            assertEquals("第 $i 个采样点被改动了", 1000, readShort(out, i * 2))
        }
    }

    @Test
    fun `stereo is mixed down to one channel`() {
        // 左右声道分别是 100 和 300，混成单声道应该是 200。
        val pcm = ByteArray(2 * 2)
        writeShort(pcm, 0, 100)
        writeShort(pcm, 2, 300)
        val out = AudioPcmPreparer.resample(pcm, 2, 16_000, 16_000, 1)
        assertEquals(2, out.size)
        assertEquals(200, readShort(out, 0))
    }

    @Test
    fun `empty or nonsensical input yields empty output instead of crashing`() {
        assertEquals(0, AudioPcmPreparer.resample(ByteArray(0), 1, 16_000, 16_000, 1).size)
        assertEquals(0, AudioPcmPreparer.resample(ByteArray(10), 0, 16_000, 16_000, 1).size)
        assertEquals(0, AudioPcmPreparer.resample(ByteArray(10), 1, 0, 16_000, 1).size)
    }

    // ---- 时长 ----

    @Test
    fun `duration is exact for canonical pcm`() {
        // 16kHz 单声道 16bit：每秒 32000 字节
        assertEquals(1_000L, AudioPcmPreparer.durationMs(32_000L))
        assertEquals(500L, AudioPcmPreparer.durationMs(16_000L))
        assertEquals(0L, AudioPcmPreparer.durationMs(0L))
    }

    @Test
    fun `duration accounts for stereo`() {
        assertEquals(500L, AudioPcmPreparer.durationMs(32_000L, 16_000, 2))
    }

    @Test
    fun `canonical format matches what soul records`() {
        // 真机实测 Soul 录音就是 16kHz / 单声道；这两个值必须和录音侧一致，
        // 否则注入时要多做一次重采样，音质和时序都会变差。
        assertEquals(16_000, AudioPcmPreparer.CANONICAL_RATE)
        assertEquals(1, AudioPcmPreparer.CANONICAL_CHANNELS)
        assertEquals(16, AudioPcmPreparer.CANONICAL_BITS)
    }
}
