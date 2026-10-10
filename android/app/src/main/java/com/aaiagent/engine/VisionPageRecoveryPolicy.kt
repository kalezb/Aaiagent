package com.aaiagent.engine

enum class VisionPageDecision {
    MESSAGE_LIST,
    CHAT,
    PROFILE,
    COMMERCE,
    NOTICE,
    OTHER,
}

object VisionPageRecoveryPolicy {
    const val PROMPT =
        "你是手机页面识别器。只根据截图判断当前页面类型。第一行只能输出一个标签：MESSAGE_LIST、CHAT、PROFILE、COMMERCE、NOTICE、OTHER。第二行用不超过20个汉字说明。不要输出分析过程。MESSAGE_LIST=消息列表；CHAT=某个联系人的聊天页；PROFILE=个人资料页；COMMERCE=会员、充值、付款、收银台页；NOTICE=平台违规、发送失败、禁言、操作限制或警告弹窗；其他一律 OTHER。"

    fun decide(description: String): VisionPageDecision {
        val text = description.uppercase()
        return when {
            "COMMERCE" in text -> VisionPageDecision.COMMERCE
            "NOTICE" in text -> VisionPageDecision.NOTICE
            "PROFILE" in text -> VisionPageDecision.PROFILE
            "MESSAGE_LIST" in text || "MESSAGE LIST" in text -> VisionPageDecision.MESSAGE_LIST
            "CHAT" in text -> VisionPageDecision.CHAT
            else -> VisionPageDecision.OTHER
        }
    }
}
