package com.aaiagent

import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.TopicMediaReplyPolicy
import com.aaiagent.network.ChatMedia
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TopicMediaReplyPolicyTest {
    private val image = ChatMedia(
        type = "image",
        assetId = "daily_01",
        groupId = "daily",
        downloadUrl = "/api/media/daily_01",
        contentType = "image/jpeg",
        fileName = "daily_01.jpg"
    )

    @Test
    fun `hosting modes use backend wire values`() {
        assertEquals("full_auto", TopicMediaReplyPolicy.wireHostingMode(HostingMode.FULL_AUTO))
        assertEquals("semi_auto", TopicMediaReplyPolicy.wireHostingMode(HostingMode.SEMI_AUTO))
        assertEquals("monitor_only", TopicMediaReplyPolicy.wireHostingMode(HostingMode.MONITOR_ONLY))
    }

    @Test
    fun `only full auto sends a complete image`() {
        assertTrue(TopicMediaReplyPolicy.shouldSendAutomatically(HostingMode.FULL_AUTO, image))
        assertFalse(TopicMediaReplyPolicy.shouldSendAutomatically(HostingMode.SEMI_AUTO, image))
        assertFalse(TopicMediaReplyPolicy.shouldSendAutomatically(HostingMode.MONITOR_ONLY, image))
        assertFalse(TopicMediaReplyPolicy.shouldSendAutomatically(HostingMode.FULL_AUTO, image.copy(downloadUrl = "")))
        assertFalse(TopicMediaReplyPolicy.shouldSendAutomatically(HostingMode.FULL_AUTO, image.copy(type = "video")))
    }

    @Test
    fun `confirmation marker keeps the selected asset id`() {
        assertEquals("[图片:daily_01]", TopicMediaReplyPolicy.confirmationContent(image))
    }
}
