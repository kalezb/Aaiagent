package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * 2026-10-07 真机（渔夫，2 秒语音）：
 *   voice transcription total=1 transcribed=1   ← 转写报告成功
 *   read items=1 preview=                        ← 转写完重读，内容却是空的
 *   于是引擎回退用了最早读到的 [语音]，模型手里只有“语音”两个字，
 *   只好编了一句“语音听了一半 后面没听清呢”。
 *
 * 所以定一条规矩：**重读必须确认内容里真的带上了转写文字，才算转写成功。**
 */
object VoiceTranscriptPolicy {
    private const val TRANSCRIPT_MARK = "语音转文字"

    /** 读出来的消息里有没有“语音转出来的文字”。 */
    fun hasSpokenText(messages: List<ChatMessage>): Boolean =
        messages.any { message ->
            message.content.contains(TRANSCRIPT_MARK) || message.transcript.isNotBlank()
        }

    /** 第 attempt 次(从 0 开始)读完之后，还值不值得再读一次。 */
    fun shouldRetry(attempt: Int, maxAttempts: Int = 3): Boolean = attempt + 1 < maxAttempts
}
