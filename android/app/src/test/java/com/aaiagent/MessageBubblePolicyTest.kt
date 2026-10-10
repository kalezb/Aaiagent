package com.aaiagent

import com.aaiagent.adapter.MessageBubblePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageBubblePolicyTest {
    private fun isMessage(
        insideProfileCard: Boolean = false,
        insideNonMessagePanel: Boolean = false,
        hasText: Boolean = false,
        hasTextContainer: Boolean = false,
        hasMedia: Boolean = false,
        relaxContentCheck: Boolean = false,
    ) = MessageBubblePolicy.isMessage(
        insideProfileCard, insideNonMessagePanel, hasText, hasTextContainer, hasMedia, relaxContentCheck
    )

    @Test
    fun `keeps a real bubble even without layout_content`() {
        // 真机原样（野兽）：新联系人页面里只有 text，没有 content_text_container
        assertTrue(isMessage(hasText = true))
        assertTrue(isMessage(hasTextContainer = true))
        assertTrue(isMessage(hasMedia = true))
    }

    @Test
    fun `drops profile page content that used to be read as messages`() {
        // 真机原样（小胡的 33 条里含星球名/标签/收藏），这些都挂在关系卡片下面
        assertFalse(isMessage(insideProfileCard = true, hasText = true))
        assertFalse(isMessage(insideProfileCard = true, hasTextContainer = true))
        assertFalse(isMessage(insideProfileCard = true, hasMedia = true))
    }

    @Test
    fun `drops media and emoji picker entries`() {
        // 真机原样：音乐面板里的“正在加载 / 全部 / 忘川彼岸”被当成消息
        assertFalse(isMessage(insideNonMessagePanel = true, hasText = true))
        assertFalse(isMessage(insideNonMessagePanel = true, hasMedia = true))
    }

    @Test
    fun `drops an item with no content at all`() {
        assertFalse(isMessage())
    }

    @Test
    fun `accepts any non-card item on a small page`() {
        // 真机原样（野兽 items=1 bubbles=0）：这条真消息既没有 content_text 也没有媒体节点
        assertTrue(isMessage(relaxContentCheck = true))
        // 但主页卡片和面板里的东西仍然必须排除
        assertFalse(isMessage(insideProfileCard = true, relaxContentCheck = true))
        assertFalse(isMessage(insideNonMessagePanel = true, relaxContentCheck = true))
    }
}
