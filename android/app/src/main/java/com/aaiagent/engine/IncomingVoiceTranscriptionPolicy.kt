package com.aaiagent.engine

import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.delay

/**
 * Keeps voice transcription inside the same immutable turn used for the model
 * request. A retry or recompute must never silently fall back to a raw [语音]
 * placeholder while a transcript exists on the page.
 */
object IncomingVoiceTranscriptionPolicy {
    suspend fun ensure(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        batch: IncomingMessageBatch.Selection,
        context: ConversationContext,
        canProceed: () -> Boolean,
        currentRoot: () -> AccessibilityNodeInfo?,
    ): IncomingMessageBatch.Selection {
        if (!hasMissingVoice(batch) || !canProceed()) return batch

        val result = adapter.transcribeIncomingVoices(root)
        android.util.Log.d(
            "AIA",
            "voice transcription total=${result.total} transcribed=${result.transcribed}",
        )
        if (!result.hasAny) return batch

        repeat(3) { attempt ->
            val refreshed = adapter.readMessages(currentRoot() ?: root)
            val freshBatch = IncomingMessageBatch.select(refreshed)
            if (freshBatch != null && VoiceTranscriptPolicy.hasSpokenText(freshBatch.incoming)) {
                return freshBatch
            }
            if (VoiceTranscriptPolicy.shouldRetry(attempt)) {
                android.util.Log.d(
                    "AIA",
                    "voice transcript not visible yet, reread attempt=${attempt + 1}",
                )
                delay(300)
            }
        }
        RuntimeJournal.log(
            "语音转写",
            "重读没拿到文字",
            "contact=${context.contactName}（本轮按“没有文字”处理）",
        )
        android.util.Log.w("AIA", "voice transcript lost after rereads contact=${context.contactName}")
        return batch
    }

    internal fun hasMissingVoice(batch: IncomingMessageBatch.Selection): Boolean {
        return batch.incoming.any { message ->
            message.type == "voice" &&
                message.transcript.isBlank() &&
                !message.content.contains("语音转文字")
        }
    }
}
