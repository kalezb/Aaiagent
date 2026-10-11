package com.aaiagent.engine.work

import com.aaiagent.adapter.PlatformAdapter

object SoulContactIdentityPolicy {
    const val AMBIGUOUS_CONFIDENCE = 0.25f
    const val NAME_ONLY_CONFIDENCE = 0.7f

    fun identity(
        conversation: PlatformAdapter.ConversationInfo,
        duplicateNameCount: Int,
    ): ConversationIdentity {
        val name = normalizeName(conversation.contactName)
        val ambiguous = duplicateNameCount > 1
        val hasPreview = conversation.preview.trim().isNotEmpty()
        return ConversationIdentity(
            platform = "soul",
            stableId = if (ambiguous) {
                "soul-ambiguous:$name:${conversation.pageIndex.coerceAtLeast(0)}:" +
                    previewHash(conversation.preview)
            } else {
                "soul-name:$name"
            },
            displayName = conversation.contactName.trim(),
            preview = conversation.preview.trim(),
            pageIndex = conversation.pageIndex.coerceAtLeast(0),
            unreadCount = if (conversation.hasUnread) 1 else 0,
            confidence = if (ambiguous && !hasPreview) AMBIGUOUS_CONFIDENCE else NAME_ONLY_CONFIDENCE,
            note = if (ambiguous && !hasPreview) "Soul 列表出现同名且无预览内容的联系人，无法安全区分" else "",
            lastMessageTime = conversation.lastMessageTime,
            origin = conversation.relationshipOrigin.name.lowercase(),
        )
    }

    fun exactNameMatches(expected: String, actual: String?): Boolean {
        val left = normalizeName(expected)
        val right = normalizeName(actual)
        return left.isNotEmpty() && left == right
    }

    fun canOpenWithoutRisk(identity: ConversationIdentity): Boolean {
        if (identity.displayName.isBlank()) return false
        if (identity.confidence > AMBIGUOUS_CONFIDENCE && identity.note.isBlank()) return true
        // 带有非空预览内容的联系人可以通过“名字+内容预览”精确定位，允许安全打开
        return identity.preview.isNotBlank()
    }

    private fun previewHash(preview: String): String {
        return preview.trim().hashCode().toUInt().toString(16)
    }

    fun normalizeName(value: String?): String {
        return value.orEmpty()
            .replace(Regex("[\\s\\u200B-\\u200D\\uFEFF]+"), "")
            .replace(Regex("(?i)(正在输入|在线|离线|已读|未读)$"), "")
            .trim()
    }
}

object SoulRiskOverlayPolicy {
    const val POST_RISK_REASON = "SOUL_MOMENT_POST_RISK_DIALOG"
    const val POST_RISK_TEXT = "本次交易存在欺诈风险"
    const val UNLOCK_TEXT = "申请解除限制"
    const val CLOSE_TEXT = "关闭"

    fun isPostRiskDialog(
        visibleTexts: Collection<String>,
        contentDescriptions: Collection<String> = emptyList(),
    ): Boolean {
        val text = (visibleTexts + contentDescriptions).joinToString("\n")
        return text.contains(POST_RISK_TEXT) &&
            text.contains(UNLOCK_TEXT) &&
            text.contains(CLOSE_TEXT)
    }

    fun safeRecoveryAction(): String = "press_back_to_message_list"
}
