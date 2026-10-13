package com.aaiagent.network

import com.google.gson.annotations.SerializedName

data class FishAudioCapabilitiesResponse(
    val provider: String?,
    val configured: Boolean?,
    val models: FishAudioModels?,
    val features: Map<String, Boolean>?,
    val error: String?
)

data class FishAudioModels(
    val tts: String?,
    val asr: String?,
    @SerializedName("voice_design") val voiceDesign: String?
)

data class SpeechSynthesisResult(
    val contentType: String?,
    val audio: ByteArray
)

/**
 * 情绪表演层的结果。
 *
 * [taggedText] 是可以直接发给 Fish 的文本（可能带官方情绪标签）；
 * [state] 是更新后的情绪状态，下一轮原样传回去，情绪才连得起来。
 */
data class VoicePerformanceResponse(
    @SerializedName("tagged_text") val taggedText: String?,
    val state: String?,
    @SerializedName("dominant_emotion") val dominantEmotion: String?,
    val planned: Boolean,
    val reason: String?
)

data class SpeechTranscriptionResponse(
    val text: String?,
    val duration: Double?,
    val segments: List<SpeechTranscriptionSegment>?,
    @SerializedName("language_code") val languageCode: String?,
    val language: String?
)

data class SpeechTranscriptionSegment(
    val text: String?,
    val start: Double?,
    val end: Double?
)
