package com.aaiagent.engine

/**
 * Soul 列表页告诉我们的“这个人是怎么来的”。
 * 它只说明关系来源，不等于当前聊天进度。
 */
enum class RelationshipOrigin {
    MATCH,
    SERENDIPITY,
    SOULMATE,
    UNKNOWN,
}

/**
 * 聊天页才是最终判据：当前已经聊到了哪一步。
 */
enum class ConversationStage {
    FIRST_CONTACT,
    CONTINUING,
    FAMILIAR,
    SOULMATE,
    UNKNOWN,
}

/**
 * 聊天页上哪些控件才算真的“关系标记”。
 *
 * 2026-11-03 真机：layout_heart 其实是每张聊天页都有的背景装饰（空节点、不能点、
 * 位置固定在屏幕右侧），拿它当“心形关系”标记，会把刚加上的人全判成“已经比较熟悉”，
 * 后端于是往提示词里写“你们已经很熟，可以沿用之前的称呼”，开口就像老朋友。
 * 真正的心形关系标记只有 lot_heart_pet。
 */
object SoulChatMarkerPolicy {
    val HEART_MARKER_IDS = setOf("lot_heart_pet")
}

object SoulConversationStagePolicy {
    fun classifyListOrigin(
        originLabel: String,
        hasSoulmateMarker: Boolean,
    ): RelationshipOrigin {
        if (hasSoulmateMarker) return RelationshipOrigin.SOULMATE
        return when (originLabel.trim()) {
            "匹配" -> RelationshipOrigin.MATCH
            "奇遇铃" -> RelationshipOrigin.SERENDIPITY
            else -> RelationshipOrigin.UNKNOWN
        }
    }

    /**
     * 判定顺序故意固定：
     * Soulmate > 心形阶段 > 已有我方消息 > 初始关系卡 > 未知。
     *
     * 初始关系卡和心形可能同时出现，所以不能看到 clCardRoot 就判成第一次聊天。
     */
    fun classifyChatStage(
        hasSoulmateMarker: Boolean,
        hasHeartMarker: Boolean,
        hasProfileCard: Boolean,
        outgoingCount: Int,
        visibleMessageCount: Int,
    ): ConversationStage {
        if (hasSoulmateMarker) return ConversationStage.SOULMATE
        if (hasHeartMarker) return ConversationStage.FAMILIAR
        if (outgoingCount > 0) return ConversationStage.CONTINUING
        if (hasProfileCard && visibleMessageCount > 0) return ConversationStage.FIRST_CONTACT
        return ConversationStage.UNKNOWN
    }
}
