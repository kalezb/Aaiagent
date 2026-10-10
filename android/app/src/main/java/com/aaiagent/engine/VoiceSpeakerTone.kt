package com.aaiagent.engine

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * 外放的"声音整形"：让配音经过手机小喇叭之后，听起来更像人、更不像在放录音。
 *
 * 两个问题分开治：
 *
 * **① 喇叭的物理特性**（`applyEq`）
 * 手机的喇叭放不出低音，硬送 300Hz 以下只会让它失真、发出嗡嗡声 ——
 * 直接砍掉反而更干净。人声的清晰度集中在 1-3kHz，稍微抬一点；
 * 3-4kHz 轻微提升能让人声更"实"、更有存在感。
 *
 * **② 音量忽大忽小**（`compress`）—— 这一条最能减轻"外放感"
 * 真人说话音量是自然起伏的，而外放时 Soul 的自动增益会不停调整，
 * 那种"抽动感"特别像机器放的。压限把音量压平，麦克风那边的增益就不用一直动，
 * 听感会自然很多。
 *
 * 全部跑在播放之前、跑在 16kHz 的原始数据上（点数是 48kHz 的三分之一，省算力）。
 * 所有参数都是"通用手机喇叭"的经验值，不是针对某一台测过的。
 */
object VoiceSpeakerTone {

    /** 砍掉这个频率以下 —— 小喇叭放不出来，留着只会失真。 */
    const val HIGH_PASS_HZ = 280.0

    /** 语音段的提升中心与幅度。 */
    const val PRESENCE_HZ = 2_000.0
    const val PRESENCE_GAIN_DB = 3.0

    /** 存在感/清晰度的轻微提升。 */
    const val CLARITY_HZ = 3_600.0
    const val CLARITY_GAIN_DB = 2.0

    /** 压限参数：温和为主 —— 压太狠会听出"喘气"感，比不压还假。 */
    const val COMPRESSOR_THRESHOLD_DB = -18.0
    const val COMPRESSOR_RATIO = 2.5
    const val COMPRESSOR_ATTACK_MS = 12.0
    const val COMPRESSOR_RELEASE_MS = 140.0

    /**
     * 完整处理链：**均衡 → 压限 → 归一化**。
     *
     * 归一化放在最后：均衡和压限都会改变峰值，最后统一把峰值定到目标位置，
     * 保证既足够响、又绝不削波。
     */
    fun prepare(pcm: ByteArray, sampleRate: Int): ByteArray {
        if (pcm.size < 4 || sampleRate <= 0) return pcm
        var out = applyEq(pcm, sampleRate)
        out = compress(out, sampleRate)
        // 双向归一：均衡和压限都可能把峰值推高，只放大不压下去就会削波。
        out = VoiceSpeakerPlayback.normalizePeak(out)
        return out
    }

    /**
     * 均衡：高通 + 两段轻微的语音提升。
     *
     * 处理全程用 Double，最后再夹回 16 位 —— 中间不做整数舍入，免得累积量化噪声。
     */
    fun applyEq(pcm: ByteArray, sampleRate: Int): ByteArray {
        if (pcm.size < 4 || sampleRate <= 0) return pcm
        val highPass = Biquad.highPass(HIGH_PASS_HZ, 0.7071, sampleRate)
        val presence = Biquad.peaking(PRESENCE_HZ, 0.9, PRESENCE_GAIN_DB, sampleRate)
        val clarity = Biquad.peaking(CLARITY_HZ, 0.9, CLARITY_GAIN_DB, sampleRate)

        val out = ByteArray(pcm.size)
        var index = 0
        while (index + 1 < pcm.size) {
            var value = readSample(pcm, index).toDouble()
            value = highPass.process(value)
            value = presence.process(value)
            value = clarity.process(value)
            writeSample(out, index, value.roundToInt())
            index += 2
        }
        return out
    }

    /**
     * 温和的压限：把超过阈值的部分按比例压下来，让整体音量更平。
     *
     * 用"峰值包络 + 攻放时间"的经典做法：起音快（12ms，抓住突然的响）、
     * 释放慢（140ms，松开时不突兀），这样不会听出抽动。
     */
    fun compress(pcm: ByteArray, sampleRate: Int): ByteArray {
        if (pcm.size < 4 || sampleRate <= 0) return pcm
        val threshold = 10.0.pow(COMPRESSOR_THRESHOLD_DB / 20.0)
        val attack = exp(-1.0 / (COMPRESSOR_ATTACK_MS / 1000.0 * sampleRate))
        val release = exp(-1.0 / (COMPRESSOR_RELEASE_MS / 1000.0 * sampleRate))
        val slope = (1.0 / COMPRESSOR_RATIO) - 1.0

        val out = ByteArray(pcm.size)
        var envelope = 0.0
        var index = 0
        while (index + 1 < pcm.size) {
            val sample = readSample(pcm, index)
            val level = abs(sample) / 32768.0
            val coefficient = if (level > envelope) attack else release
            envelope = coefficient * envelope + (1.0 - coefficient) * level

            val gain = if (envelope > threshold) {
                (envelope / threshold).pow(slope)
            } else {
                1.0
            }
            writeSample(out, index, (sample * gain).roundToInt())
            index += 2
        }
        return out
    }

    private fun readSample(pcm: ByteArray, index: Int): Int {
        val low = pcm[index].toInt() and 0xFF
        val high = pcm[index + 1].toInt()
        return (high shl 8) or low
    }

    private fun writeSample(out: ByteArray, index: Int, value: Int) {
        val clamped = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
        out[index] = (clamped and 0xFF).toByte()
        out[index + 1] = ((clamped shr 8) and 0xFF).toByte()
    }

    /**
     * 二阶滤波器（biquad）。系数用 RBJ 的经典公式算。
     *
     * 单独做成内部类是为了能脱离安卓做单测 —— 滤波系数算错的话，
     * 表现是"声音变闷/变尖/破音"，那种问题只有耳朵能发现、很难查。
     */
    internal class Biquad(
        private val b0: Double,
        private val b1: Double,
        private val b2: Double,
        private val a1: Double,
        private val a2: Double
    ) {
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        fun process(input: Double): Double {
            val output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = input
            y2 = y1
            y1 = output
            return output
        }

        companion object {
            /** 二阶高通（Butterworth，Q = 0.7071）。 */
            fun highPass(frequencyHz: Double, q: Double, sampleRate: Int): Biquad {
                val w0 = 2.0 * Math.PI * (frequencyHz / sampleRate)
                val cosW0 = kotlin.math.cos(w0)
                val alpha = kotlin.math.sin(w0) / (2.0 * q)
                val a0 = 1.0 + alpha
                return Biquad(
                    b0 = ((1.0 + cosW0) / 2.0) / a0,
                    b1 = (-(1.0 + cosW0)) / a0,
                    b2 = ((1.0 + cosW0) / 2.0) / a0,
                    a1 = (-2.0 * cosW0) / a0,
                    a2 = (1.0 - alpha) / a0
                )
            }

            /** 峰值均衡（peaking EQ）：在某个中心频率附近提升/衰减一定分贝。 */
            fun peaking(
                frequencyHz: Double,
                q: Double,
                gainDb: Double,
                sampleRate: Int
            ): Biquad {
                val a = 10.0.pow(gainDb / 40.0)
                val w0 = 2.0 * Math.PI * (frequencyHz / sampleRate)
                val cosW0 = kotlin.math.cos(w0)
                val alpha = kotlin.math.sin(w0) / (2.0 * q)
                val a0 = 1.0 + alpha / a
                return Biquad(
                    b0 = (1.0 + alpha * a) / a0,
                    b1 = (-2.0 * cosW0) / a0,
                    b2 = (1.0 - alpha * a) / a0,
                    a1 = (-2.0 * cosW0) / a0,
                    a2 = (1.0 - alpha / a) / a0
                )
            }
        }
    }
}
