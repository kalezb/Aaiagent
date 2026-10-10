package com.aaiagent.engine

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException

/**
 * 把 Fish Audio 返回的音频（mp3 / wav）解成"注入 Soul 麦克风"要用的原始 PCM。
 *
 * 统一成 **16kHz / 单声道 / 16bit 小端** —— Soul 录音用的就是这个格式，
 * 两边一致就可以免掉注入时的二次重采样。
 *
 * 解码和重采样都是纯计算（不碰界面、不碰网络），所以可以脱离安卓做单元测试。
 * 这类"音频处理"最容易出静音、变调、爆音这种隐蔽问题，有测试兜底很值。
 */
object AudioPcmPreparer {

    const val CANONICAL_RATE = 16_000
    const val CANONICAL_CHANNELS = 1
    const val CANONICAL_BITS = 16

    data class Decoded(val pcm: ByteArray, val rate: Int, val channels: Int)

    /** 解码 + 重采样成规范 PCM，直接可以交给注入模块。 */
    fun toCanonicalPcm(file: File): ByteArray {
        val decoded = decodeFile(file)
        return resample(
            src = decoded.pcm,
            srcCh = decoded.channels,
            srcRate = decoded.rate,
            dstRate = CANONICAL_RATE,
            dstCh = CANONICAL_CHANNELS
        )
    }

    fun decodeFile(file: File): Decoded = when {
        file.extension.equals("wav", true) -> parseWav(file.readBytes())
        else -> decodeWithCodec(file)
    }

    /**
     * 解析 WAV。纯函数，可单测。
     *
     * 只认 RIFF/WAVE + fmt/data 两个块；8bit 会转成 16bit。
     * 找不到 data 块直接抛异常 —— 宁可失败，也不要喂一段静音进去。
     */
    fun parseWav(bytes: ByteArray): Decoded {
        if (bytes.size < 44) throw IOException("wav too small")
        if (String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") {
            throw IOException("not wav")
        }
        var pos = 12
        var rate = 44_100
        var channels = 1
        var bits = 16
        var dataOffset = -1
        var dataLength = 0
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4)
            val size = leInt(bytes, pos + 4)
            if (id == "fmt ") {
                val ds = pos + 8
                if (ds + 16 <= bytes.size) {
                    channels = leShort(bytes, ds + 2).coerceAtLeast(1)
                    rate = leInt(bytes, ds + 4).coerceAtLeast(8_000)
                    bits = leShort(bytes, ds + 14).coerceAtLeast(8)
                }
            } else if (id == "data") {
                dataOffset = pos + 8
                dataLength = size
                break
            }
            pos = pos + 8 + size + (size and 1)
        }
        if (dataOffset < 0) throw IOException("no data chunk")
        val end = (dataOffset + dataLength).coerceAtMost(bytes.size)
        if (end <= dataOffset) throw IOException("empty data chunk")
        val raw = bytes.copyOfRange(dataOffset, end)
        val pcm = if (bits <= 8) unsigned8ToSigned16(raw) else raw
        return Decoded(pcm, rate, channels)
    }

    /**
     * 用系统解码器解 mp3 之类。需要文件路径，所以这里不走纯函数。
     *
     * 输出按"交错 16bit"拼接；采样率/声道从轨道信息里读。
     */
    fun decodeWithCodec(file: File): Decoded {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)
        var trackIndex = -1
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                trackIndex = i
                break
            }
        }
        if (trackIndex < 0) {
            extractor.release()
            throw IOException("no audio track")
        }
        val format = extractor.getTrackFormat(trackIndex)
        val rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE).coerceAtLeast(8_000)
        val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: "audio/mpeg"
        extractor.selectTrack(trackIndex)

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        val out = ByteArrayOutputStream()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val inBuf = codec.getInputBuffer(inIndex)
                        if (inBuf != null) {
                            val size = extractor.readSampleData(inBuf, 0)
                            if (size < 0) {
                                codec.queueInputBuffer(
                                    inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                )
                                inputDone = true
                            } else {
                                codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                }
                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                if (outIndex >= 0) {
                    if (info.size > 0) {
                        val outBuf = codec.getOutputBuffer(outIndex)
                        if (outBuf != null) {
                            outBuf.position(info.offset)
                            outBuf.limit(info.offset + info.size)
                            val chunk = ByteArray(info.size)
                            outBuf.get(chunk)
                            out.write(chunk)
                        }
                    }
                    codec.releaseOutputBuffer(outIndex, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
                }
            }
        } finally {
            try {
                codec.stop()
            } catch (_: Throwable) {
            }
            try {
                codec.release()
            } catch (_: Throwable) {
            }
            try {
                extractor.release()
            } catch (_: Throwable) {
            }
        }
        val pcm = out.toByteArray()
        if (pcm.isEmpty()) throw IOException("decoded to nothing")
        return Decoded(pcm, rate, channels)
    }

    /**
     * 把任意采样率/声道的 16bit PCM 线性重采样成 dstRate/dstChannels（都混成单声道）。
     * 纯函数，可单测。
     */
    fun resample(
        src: ByteArray,
        srcCh: Int,
        srcRate: Int,
        dstRate: Int,
        dstCh: Int
    ): ByteArray {
        if (srcCh <= 0 || srcRate <= 0 || dstRate <= 0 || dstCh <= 0) return ByteArray(0)
        val srcFrames = src.size / (2 * srcCh)
        if (srcFrames <= 0) return ByteArray(0)
        if (srcCh == dstCh && srcRate == dstRate) return src
        val dstFrames = (srcFrames.toLong() * dstRate / srcRate).toInt().coerceAtLeast(1)
        val out = ByteArray(dstFrames * dstCh * 2)
        for (n in 0 until dstFrames) {
            val position = n.toDouble() * srcFrames / dstFrames
            val i0 = position.toInt().coerceIn(0, srcFrames - 1)
            val i1 = (i0 + 1).coerceIn(0, srcFrames - 1)
            val frac = (position - i0).coerceIn(0.0, 1.0)
            val s0 = frameMono(src, srcCh, i0)
            val s1 = frameMono(src, srcCh, i1)
            val value = (s0 + (s1 - s0) * frac).toInt()
            for (c in 0 until dstCh) {
                val index = (n * dstCh + c) * 2
                out[index] = (value and 0xFF).toByte()
                out[index + 1] = ((value shr 8) and 0xFF).toByte()
            }
        }
        return out
    }

    /** 16bit PCM 有多少毫秒。用来算"这段配音要录多久"。 */
    fun durationMs(
        pcmBytes: Long,
        rate: Int = CANONICAL_RATE,
        channels: Int = CANONICAL_CHANNELS
    ): Long {
        if (pcmBytes <= 0L || rate <= 0 || channels <= 0) return 0L
        return pcmBytes * 1_000L / (2L * rate * channels)
    }

    private fun frameMono(pcm: ByteArray, channels: Int, frame: Int): Int {
        var sum = 0L
        for (c in 0 until channels) {
            val index = (frame * channels + c) * 2
            if (index + 1 >= pcm.size) break
            val lo = pcm[index].toInt() and 0xFF
            val hi = pcm[index + 1].toInt() and 0xFF
            sum += (lo or (hi shl 8)).toShort().toInt()
        }
        return (sum / channels).toInt()
    }

    private fun unsigned8ToSigned16(data: ByteArray): ByteArray {
        val out = ByteArray(data.size * 2)
        for (i in data.indices) {
            val value = (data[i].toInt() and 0xFF) - 128
            out[i * 2] = (value and 0xFF).toByte()
            out[i * 2 + 1] = ((value shr 8) and 0xFF).toByte()
        }
        return out
    }

    private fun leShort(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)

    private fun leInt(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 3].toInt() and 0xFF) shl 24)
}
