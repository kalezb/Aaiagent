package com.aaiagent.engine

import com.aaiagent.network.ChatMedia

object TopicMediaReplyPolicy {
    fun wireHostingMode(mode: HostingMode): String = when (mode) {
        HostingMode.FULL_AUTO -> "full_auto"
        HostingMode.SEMI_AUTO -> "semi_auto"
        HostingMode.MONITOR_ONLY -> "monitor_only"
    }

    fun isCompleteMedia(media: ChatMedia?): Boolean {
        return media?.type == "image" &&
            !media.assetId.isNullOrBlank() &&
            !media.downloadUrl.isNullOrBlank()
    }

    fun shouldSendAutomatically(mode: HostingMode, media: ChatMedia?): Boolean {
        return mode == HostingMode.FULL_AUTO && isCompleteMedia(media)
    }

    fun confirmationContent(media: ChatMedia): String {
        return "[图片:${media.assetId.orEmpty().trim()}]"
    }
}
