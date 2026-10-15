package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter.ChatMessage

/**
 * 表情是一轮聊天里的状态和语气，不是一条必须单独回复的任务。
 * 只有带明显交流意图的问好、晚安这类表情，才继续走模型回复。
 */
object StickerTurnPolicy {
    private val MEDIA_PLACEHOLDER = Regex(
        "^\\[(?:图片|语音|闪照|以图换图|对方转发了你本人的动态)(?::[^\\]]*)?\\]$"
    )
    private val NAMED_STICKER = Regex(
        "^(?:\\[(?:表情包|互动表情|Soul互动表情|语音互动表情|表情)(?::[^\\]]*)?\\]|" +
            "对方发来\\s*(?:一个友好互动表情|(?:(?:Soul\\s*)?(?:官方|时段问候|互动)?表情)[「“][^」”]{1,20}[」”]))"
    )
    private val SHORT_BRACKET_STICKER = Regex("^\\[[^\\]\\n]{1,12}\\](?:\\[[^\\]\\n]{1,12}\\])*$")
    private val GREETING = Regex(
        "(?:你好|您好|哈喽|嗨|早上好|早安|上午好|中午好|午安|下午好|晚上好|晚安|月亮|太阳|打招呼|问候)"
    )
    private val NON_STICKER_MEDIA = setOf(
        "voice",
        "image",
        "exchange",
        "voice_emoji",
        "moment_card",
    )

    fun isStateSticker(content: String): Boolean {
        val text = content.trim()
        if (text.isEmpty() || MEDIA_PLACEHOLDER.matches(text)) return false
        return NAMED_STICKER.containsMatchIn(text) || SHORT_BRACKET_STICKER.matches(text)
    }

    fun isGreetingSticker(content: String): Boolean {
        if (!isStateSticker(content)) return false
        val label = content
            .replace(Regex("^对方发来\\s*(?:Soul\\s*)?(?:官方|时段问候|互动)?表情[「“]"), "")
            .replace(Regex("[\\[\\]【】「」“”]"), "")
            .replace(Regex("^(?:表情包|互动表情|Soul互动表情|语音互动表情|表情)[：:]\\s*"), "")
            .trim()
        return GREETING.containsMatchIn(label)
    }

    fun shouldReplyToBatch(batch: IncomingMessageBatch.Selection): Boolean {
        val incoming = batch.incoming
        if (incoming.isEmpty()) return false
        if (incoming.any { message ->
                message.type == "text" &&
                    message.content.trim().isNotEmpty() &&
                    !isStateSticker(message.content)
            }
        ) {
            return true
        }
        if (incoming.any { it.type in NON_STICKER_MEDIA }) return true
        val stickers = incoming.filter { isStateSticker(it.content) }
        return stickers.isNotEmpty() && stickers.any { isGreetingSticker(it.content) }
    }
}
