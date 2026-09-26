package com.aaiagent.engine

object ImageUnderstandingPolicy {
    const val VISION_PROMPT =
        "客观识别图中主要内容，优先说明主体是人还是物。" +
            "如果可见人物，明确描述儿童、少年或成年，以及明显的外貌、衣着和气质；" +
            "如果可见文字，原样写出；不要补充图片中没有的内容。"

    fun modelFacts(type: String, description: String): String {
        val source = when (type) {
            "exchange" -> "对方发来的以图换图照片"
            "image" -> "对方发来的图片"
            "sticker" -> "对方发来的表情"
            "interaction" -> "对方发来的互动表情"
            "voice" -> "对方语音的截图辅助内容"
            else -> "对方发来的媒体内容"
        }
        return "$source，客观识别事实：${description.trim()}。" +
            "回复必须以这条识别事实为准，不能改猜成其他人或无关物品。"
    }
}
