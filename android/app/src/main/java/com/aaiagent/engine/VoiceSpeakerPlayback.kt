package com.aaiagent.engine

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import kotlin.math.abs
import kotlin.math.roundToInt
/**
 * 外放：把配音用扬声器放出来，让 Soul 的麦克风录进去。
 *
 * 这条路的代价（用户已经知情）：
 * - 录进去的会带上**房间回声和环境噪音**；
 * - 如果 Soul 开了回声消除（AEC），放出来的声音可能被它当成回声**消掉一部分**。
 *
 * **音量一律不动。** 用户明确要求音量由他自己控制
 * （"有时候音量太大了也不合适"）。所以这里只**读**音量、太低时给出结论，
 * 绝不擅自调高或调低。
 *
 * 为了把音质做到这条路的极限，播放前会做两件事（都是纯计算，可单测）：
 * 1. **数字增益归一化** —— 把配音本身放大到接近满幅。媒体音量没动，
 *    但送进扬声器的信号变强了 → 信噪比变好 → Soul 不必拼命拉麦克风增益 →
 *    **电流麦/底噪会明显下降**（真机 2026-10-06 的杂音主因就是这个）。
 * 2. **重采样到 48kHz** —— 配音原本是 16kHz（电话音质），安卓要现场转换一次，
 *    转换本身会产生怪声。先转好再放，扬声器的再现更干净。
 */
object VoiceSpeakerPlayback {

    /** 音量低于这个百分比就提醒一句 —— 太轻了麦克风基本录不到。 */
    const val LOW_VOLUME_WARN_PERCENT = 30

    /**
     * 低于这个音量，外放**必然**录出一段没声音的语音气泡。
     *
     * 真机事故（2026-10-06 19:46）：手机媒体音量是 0，播放"成功"（completed=true）
     * 但一声没出，录进去的是空气 —— 对方点开一片安静，这比不发还糟（当场穿帮）。
     *
     * 音量归用户管，我们**绝不调**；但低到这个程度就**放弃语音、改用文字**。
     */
    const val UNUSABLE_VOLUME_PERCENT = 10

    /**
     * 归一化的目标峰值（相对满幅）。留一点余量避免削波 —— 削波会产生刺耳的破音，
     * 比稍微轻一点糟得多。
     */
    const val TARGET_PEAK_RATIO = 0.92

    /**
     * 增益上限。配音本来就轻的时候最多放大到 8 倍；
     * 再往上就是把底噪也一起喊出来，没有意义。
     */
    const val MAX_GAIN = 8.0

    /** 播放用的采样率。16kHz 的配音会先重采样到它。 */
    const val PLAYBACK_SAMPLE_RATE = 48_000

    /**
     * 这个音量下外放还有意义吗。
     *
     * 读不到音量（-1）时**不当成不可用** —— 宁可按当前情况试一次，
     * 也不要因为读不到就把整条语音能力关掉。
     */
    fun isVolumeUsableForSpeaker(percent: Int): Boolean =
        percent < 0 || percent >= UNUSABLE_VOLUME_PERCENT

    /** 当前媒体音量占满量的百分比（0-100）。读不到时返回 -1。 */
    fun mediaVolumePercent(audioManager: AudioManager?): Int {
        val am = audioManager ?: return -1
        return runCatching {
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            if (max <= 0) return -1
            val current = am.getStreamVolume(AudioManager.STREAM_MUSIC)
            (current * 100 / max).coerceIn(0, 100)
        }.getOrDefault(-1)
    }

    /** 音量是不是太低（低到麦克风可能录不到）。读不到音量时不当成"太低"。 */
    fun isVolumeTooLow(percent: Int): Boolean = percent in 0 until LOW_VOLUME_WARN_PERCENT

    /**
     * 把这段 16 位 PCM 放大到接近满幅（峰值为 [targetPeakRatio]）。
     *
     * 为什么有效：外放录进麦克风的音量 = 扬声器音量 × 麦克风增益。
     * 配音本身太轻时，Soul 的自动增益会把**麦克风**灵敏度拉满，
     * 底噪跟着一起被放大 —— 这就是"电流麦"的来源。
     * 先把配音数字放大，送出去的信号强了，麦克风就不必拉那么猛。
     *
     * 已经是满幅、或者整段是静音时**原样返回**（不做无谓的处理）。
     */
    fun normalizePcm16(pcm: ByteArray, targetPeakRatio: Double = TARGET_PEAK_RATIO): ByteArray {
        if (pcm.size < 2) return pcm
        val gain = normalizeGain(pcm, targetPeakRatio)
        if (gain <= 1.0) return pcm

        val out = ByteArray(pcm.size)
        var index = 0
        while (index + 1 < pcm.size) {
            val scaled = (readSample(pcm, index) * gain).roundToInt()
            val clamped = scaled.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[index] = (clamped and 0xFF).toByte()
            out[index + 1] = ((clamped shr 8) and 0xFF).toByte()
            index += 2
        }
        return out
    }

    /**
     * 归一化会用到的增益倍数（1.0 = 不用放大）。
     *
     * 单独暴露出来是为了能**记进日志**：只有看到这个数，
     * 才知道"数字增益到底有没有生效、放大了几倍"。
     */
    fun normalizeGain(pcm: ByteArray, targetPeakRatio: Double = TARGET_PEAK_RATIO): Double {
        if (pcm.size < 2) return 1.0
        var peak = 0
        var index = 0
        while (index + 1 < pcm.size) {
            val magnitude = abs(readSample(pcm, index))
            if (magnitude > peak) peak = magnitude
            index += 2
        }
        if (peak == 0) return 1.0
        val target = (Short.MAX_VALUE * targetPeakRatio).roundToInt()
        return (target.toDouble() / peak.toDouble()).coerceAtMost(MAX_GAIN).coerceAtLeast(1.0)
    }

    /**
     * 16 位单声道 PCM 的线性插值重采样。
     *
     * 只用于**升采样**（16k → 48k）：升采样不会产生混叠，线性插值足够了。
     * 降采样会混叠，那种情况这里不处理（用不上）。
     */
    fun resamplePcm16(pcm: ByteArray, fromRate: Int, toRate: Int): ByteArray {
        if (pcm.size < 4 || fromRate <= 0 || toRate <= 0 || fromRate == toRate) return pcm
        val inputFrames = pcm.size / 2
        if (inputFrames < 2) return pcm
        val outputFrames = ((inputFrames.toLong() * toRate) / fromRate).toInt()
        if (outputFrames <= 0) return pcm

        val out = ByteArray(outputFrames * 2)
        val step = fromRate.toDouble() / toRate.toDouble()
        for (frame in 0 until outputFrames) {
            val position = frame * step
            val left = position.toInt()
            val right = if (left + 1 < inputFrames) left + 1 else left
            val fraction = position - left
            val a = readSample(pcm, left * 2)
            val b = readSample(pcm, right * 2)
            val value = (a + (b - a) * fraction).roundToInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[frame * 2] = (value and 0xFF).toByte()
            out[frame * 2 + 1] = ((value shr 8) and 0xFF).toByte()
        }
        return out
    }

    /**
     * 把整段 PCM 放完。返回是否**完整**放完（中途被打断返回 false）。
     *
     * 用阻塞式写入（WRITE_BLOCKING）：AudioTrack 的内部缓冲满了就等，
     * 这样"播完"和"录音该停了"自然对齐，不用额外猜时长。
     */
    fun play(
        pcm: ByteArray,
        sampleRate: Int,
        channelCount: Int,
        audioManager: AudioManager?,
        canProceed: () -> Boolean
    ): Boolean {
        if (pcm.isEmpty()) return false
        val percent = mediaVolumePercent(audioManager)
        if (isVolumeTooLow(percent)) {
            // 只提醒，不改。用户要求音量由他自己控制。
            Log.w("AIA", "外放音量偏低（${percent}%），麦克风可能录不清楚；按用户要求不自动调整")
        }

        // 先整形、再重采样：都是在 16k 的点数上算，比重采样后的 48k 少算三分之二。
        //
        // 整形链 = 均衡（砍掉喇叭放不出的低频、抬一点语音段）→ 压限（把音量压平）
        // → 归一化（最后统一把峰值定到目标位置，保证够响又不削波）。
        val peakBefore = peakOf(pcm)
        val shaped = VoiceSpeakerTone.prepare(pcm, if (sampleRate > 0) sampleRate else PLAYBACK_SAMPLE_RATE)
        val peakAfter = peakOf(shaped)
        val playbackRate = if (sampleRate > 0) sampleRate else PLAYBACK_SAMPLE_RATE
        val ready = resamplePcm16(shaped, playbackRate, PLAYBACK_SAMPLE_RATE)
        val finalRate = if (ready === shaped && playbackRate != PLAYBACK_SAMPLE_RATE) {
            playbackRate
        } else {
            PLAYBACK_SAMPLE_RATE
        }
        // 峰值一定要记出来：不然没法判断"整形到底有没有生效"，只能靠猜。
        Log.d(
            "AIA",
            "外放音质处理：峰值 $peakBefore → $peakAfter（满幅 ${Short.MAX_VALUE}），" +
                "原始 ${pcm.size} 字节 @${sampleRate}Hz → 播放 ${ready.size} 字节 @${finalRate}Hz"
        )

        val channelMask = if (channelCount >= 2) {
            AudioFormat.CHANNEL_OUT_STEREO
        } else {
            AudioFormat.CHANNEL_OUT_MONO
        }
        val minBuffer = AudioTrack.getMinBufferSize(
            finalRate,
            channelMask,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = if (minBuffer > 0) minBuffer else ready.size.coerceAtLeast(4096)

        val track = runCatching {
            AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(finalRate)
                    .setChannelMask(channelMask)
                    .build(),
                bufferSize,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            )
        }.getOrElse { error ->
            Log.w("AIA", "外放初始化失败: ${error.message}")
            return false
        }

        var written = 0
        return try {
            track.play()
            while (written < ready.size) {
                if (!canProceed()) return false
                val chunk = minOf(bufferSize, ready.size - written)
                val n = track.write(ready, written, chunk, AudioTrack.WRITE_BLOCKING)
                if (n <= 0) break
                written += n
            }
            // 等最后一段真的从扬声器出去，否则会被下一次操作截断。
            runCatching { track.stop() }
            written >= ready.size
        } catch (error: Exception) {
            Log.w("AIA", "外放播放失败: ${error.message}")
            false
        } finally {
            runCatching { track.release() }
        }
    }

    /**
     * 把峰值**双向**归一到目标位置：轻的抬上来、响的压下去。
     *
     * 跟 [normalizePcm16] 的区别：那个只做"放大"（专门用来把太轻的配音抬起来）；
     * 这个两个方向都做。**整形链的最后一步必须用这个** ——
     * 均衡和压限都可能把峰值推高，只放大不压下去就会削波
     * （真机表现是刺耳的破音，比稍微轻一点糟得多）。
     */
    fun normalizePeak(pcm: ByteArray, targetPeakRatio: Double = TARGET_PEAK_RATIO): ByteArray {
        if (pcm.size < 2) return pcm
        val peak = peakOf(pcm)
        if (peak == 0) return pcm
        val target = (Short.MAX_VALUE * targetPeakRatio).roundToInt()
        if (peak == target) return pcm

        val gain = target.toDouble() / peak.toDouble()
        val out = ByteArray(pcm.size)
        var index = 0
        while (index + 1 < pcm.size) {
            val scaled = (readSample(pcm, index) * gain).roundToInt()
            val clamped = scaled.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[index] = (clamped and 0xFF).toByte()
            out[index + 1] = ((clamped shr 8) and 0xFF).toByte()
            index += 2
        }
        return out
    }

    /** 读一个 16 位小端样本。 */
    private fun readSample(pcm: ByteArray, index: Int): Int {
        val low = pcm[index].toInt() and 0xFF
        val high = pcm[index + 1].toInt()
        return (high shl 8) or low
    }

    /** 整段的峰值（绝对值最大）。用来记日志、判断处理有没有生效。 */
    fun peakOf(pcm: ByteArray): Int {
        var peak = 0
        var index = 0
        while (index + 1 < pcm.size) {
            val magnitude = abs(readSample(pcm, index))
            if (magnitude > peak) peak = magnitude
            index += 2
        }
        return peak
    }
}
