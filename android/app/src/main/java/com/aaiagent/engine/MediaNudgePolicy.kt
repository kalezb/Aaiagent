package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository

data class MediaNudgeState(
    val consecutiveCount: Int = 0,
    val lastEventAtMs: Long = 0L,
    val lastHandledFingerprint: String = "",
    val lastHandledAtMs: Long = 0L
)

enum class MediaNudgeDecision {
    NORMAL,
    FIXED_REPLY,
    DUPLICATE,
    STOP
}

data class MediaNudgeEvaluation(
    val decision: MediaNudgeDecision,
    val nextState: MediaNudgeState,
    val reply: String? = null
)

object MediaNudgePolicy {
    const val EVENT_WINDOW_MS = 24 * 60 * 60 * 1000L
    const val HANDLED_COOLDOWN_MS = 10 * 60 * 1000L

    private val guardedTypes = setOf("sticker", "voice", "interaction")

    fun evaluate(
        mediaType: String?,
        visibleFingerprint: String,
        state: MediaNudgeState,
        nowMs: Long = System.currentTimeMillis()
    ): MediaNudgeEvaluation {
        if (visibleFingerprint.isNotEmpty() &&
            state.lastHandledFingerprint == visibleFingerprint &&
            nowMs - state.lastHandledAtMs in 0 until HANDLED_COOLDOWN_MS
        ) {
            return MediaNudgeEvaluation(MediaNudgeDecision.DUPLICATE, state)
        }

        val guardedType = mediaType
        if (guardedType == null || guardedType !in guardedTypes) {
            return MediaNudgeEvaluation(
                decision = MediaNudgeDecision.NORMAL,
                nextState = state.copy(consecutiveCount = 0, lastEventAtMs = 0L)
            )
        }

        val recentEvent = state.lastEventAtMs > 0L &&
            nowMs - state.lastEventAtMs in 0..EVENT_WINDOW_MS
        val count = if (recentEvent) state.consecutiveCount + 1 else 1
        val nextState = state.copy(consecutiveCount = count, lastEventAtMs = nowMs)
        if (count >= 3) {
            return MediaNudgeEvaluation(MediaNudgeDecision.STOP, nextState)
        }

        return MediaNudgeEvaluation(
            decision = MediaNudgeDecision.FIXED_REPLY,
            nextState = nextState,
            reply = fixedReply(guardedType, count)
        )
    }

    fun markHandled(
        state: MediaNudgeState,
        visibleFingerprint: String,
        nowMs: Long = System.currentTimeMillis()
    ): MediaNudgeState {
        return state.copy(
            lastHandledFingerprint = visibleFingerprint,
            lastHandledAtMs = nowMs
        )
    }

    private fun fixedReply(mediaType: String, count: Int): String = when (mediaType) {
        "voice" -> if (count == 1) {
            "打字聊吧 语音不太方便听"
        } else {
            "别发语音啦 打字跟我说吧"
        }
        "sticker" -> if (count == 1) {
            "打字聊吧 我有点反感表情包"
        } else {
            "别发表情包啦 打字跟我说"
        }
        else -> if (count == 1) {
            "拍一拍收到啦 打字聊吧"
        } else {
            "别拍啦 有话打字说"
        }
    }
}

class MediaNudgeStore(private val repository: AppRepository) {
    fun load(platform: String, contactId: String): MediaNudgeState {
        return decode(repository.getConfig(key(platform, contactId)).orEmpty())
    }

    fun save(platform: String, contactId: String, state: MediaNudgeState) {
        repository.setConfig(key(platform, contactId), encode(state))
    }

    private fun key(platform: String, contactId: String): String {
        return "media_nudge_v1:$platform:$contactId"
    }

    private fun encode(state: MediaNudgeState): String {
        return listOf(
            state.consecutiveCount,
            state.lastEventAtMs,
            state.lastHandledAtMs,
            state.lastHandledFingerprint
        ).joinToString("|")
    }

    private fun decode(raw: String): MediaNudgeState {
        if (raw.isEmpty()) return MediaNudgeState()
        return runCatching {
            val parts = raw.split("|", limit = 4)
            MediaNudgeState(
                consecutiveCount = parts.getOrNull(0)?.toIntOrNull() ?: 0,
                lastEventAtMs = parts.getOrNull(1)?.toLongOrNull() ?: 0L,
                lastHandledAtMs = parts.getOrNull(2)?.toLongOrNull() ?: 0L,
                lastHandledFingerprint = parts.getOrNull(3).orEmpty()
            )
        }.getOrDefault(MediaNudgeState())
    }
}
