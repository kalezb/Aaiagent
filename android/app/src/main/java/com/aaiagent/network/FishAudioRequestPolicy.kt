package com.aaiagent.network

object FishAudioRequestPolicy {
    const val MAX_TTS_CHARS = 5_000
    const val MAX_AUDIO_BYTES = 20L * 1024L * 1024L
    const val MAX_SPEECH_BYTES = 32L * 1024L * 1024L
    const val DEFAULT_TTS_MODEL = "s2.1-pro"
    const val DEFAULT_ASR_MODEL = "transcribe-1"
    const val DEFAULT_FORMAT = "mp3"

    private val supportedTtsModels = setOf(
        "s1",
        "s2-pro",
        "s2.1-pro",
        "s2.1-pro-free",
        "drama-3-preview",
    )
    private val supportedFormats = setOf("wav", "pcm", "mp3", "opus")
    private val supportedAsrModels = setOf("transcribe-1", "transcribe-1-pro")

    fun requireSpeechText(value: String): String {
        val text = value.trim()
        require(text.isNotEmpty()) { "speech_text_empty" }
        require(text.length <= MAX_TTS_CHARS) { "speech_text_too_long" }
        return text
    }

    fun resolveTtsModel(value: String?): String {
        val model = value?.trim().orEmpty().ifEmpty { DEFAULT_TTS_MODEL }
        require(model in supportedTtsModels) { "unsupported_tts_model" }
        return model
    }

    fun resolveFormat(value: String?): String {
        val format = value?.trim()?.lowercase().orEmpty().ifEmpty { DEFAULT_FORMAT }
        require(format in supportedFormats) { "unsupported_audio_format" }
        return format
    }

    fun resolveAsrModel(value: String?): String {
        val model = value?.trim().orEmpty().ifEmpty { DEFAULT_ASR_MODEL }
        require(model in supportedAsrModels) { "unsupported_asr_model" }
        return model
    }

    fun requireAudio(audio: ByteArray) {
        require(audio.isNotEmpty()) { "audio_empty" }
        require(audio.size.toLong() <= MAX_AUDIO_BYTES) { "audio_too_large" }
    }

    fun requireSpeechResult(audio: ByteArray) {
        require(audio.isNotEmpty()) { "speech_empty_response" }
        require(audio.size.toLong() <= MAX_SPEECH_BYTES) { "speech_too_large" }
    }
}
