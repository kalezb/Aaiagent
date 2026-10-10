package com.aaiagent.engine.observability

data class AutomationAnomaly(
    val type: String,
    val reason: String,
)

class AutomationAnomalyDetector(
    private val refreshWindowMs: Long = 5_000L,
    private val sameFingerprintThreshold: Int = 3,
) {
    private var replyContextUntilMs = 0L
    private val recentListScans = ArrayDeque<ListScanObservation>()
    private val recentContentChanges = ArrayDeque<ContentChangeObservation>()
    private var lastRefreshStormAtMs: Long? = null
    private var lastContentStormAtMs: Long? = null

    fun observe(event: AutomationEvent): AutomationAnomaly? {
        if (event.event == "delivery_finished" || event.event == "return_to_list_started") {
            replyContextUntilMs = event.timestampMs + 15_000L
        }

        if (
            event.pageKind == AutomationPageKind.PROFILE_PAGE &&
            event.timestampMs <= replyContextUntilMs
        ) {
            return AutomationAnomaly(
                type = "UnexpectedProfilePageAfterReply",
                reason = "stage=${event.stage} contact=${event.contactId}",
            )
        }

        if (event.event == "content_changed") {
            val key = listOf(event.platform, event.stage, event.action).joinToString("|")
            recentContentChanges.addLast(
                ContentChangeObservation(
                    timestampMs = event.timestampMs,
                    key = key,
                )
            )
            while (
                recentContentChanges.isNotEmpty() &&
                event.timestampMs - recentContentChanges.first().timestampMs > CONTENT_CHANGE_WINDOW_MS
            ) {
                recentContentChanges.removeFirst()
            }
            val sameSourceCount = recentContentChanges.count { it.key == key }
            if (
                sameSourceCount >= CONTENT_CHANGE_STORM_THRESHOLD &&
                (lastContentStormAtMs == null ||
                    event.timestampMs - lastContentStormAtMs!! >= CONTENT_CHANGE_COOLDOWN_MS)
            ) {
                lastContentStormAtMs = event.timestampMs
                recentContentChanges.clear()
                return AutomationAnomaly(
                    type = "ConversationListRefreshStorm",
                    reason = "content_changes=$sameSourceCount window_ms=$CONTENT_CHANGE_WINDOW_MS source=$key",
                )
            }
            return null
        }

        if (event.event != "list_scan_finished") return null

        val fingerprint = event.listFingerprint.trim()
        if (fingerprint.isBlank()) return null

        recentListScans.addLast(
            ListScanObservation(
                timestampMs = event.timestampMs,
                fingerprint = fingerprint,
                unreadCount = event.unreadCount,
            )
        )
        while (
            recentListScans.isNotEmpty() &&
            event.timestampMs - recentListScans.first().timestampMs > refreshWindowMs
        ) {
            recentListScans.removeFirst()
        }

        val sameFingerprint = recentListScans.filter { it.fingerprint == fingerprint }
        val allNoUnread = sameFingerprint.all { it.unreadCount <= 0 }
        if (
            allNoUnread &&
            sameFingerprint.size >= sameFingerprintThreshold &&
            (lastRefreshStormAtMs == null ||
                event.timestampMs - lastRefreshStormAtMs!! >= refreshWindowMs)
        ) {
            lastRefreshStormAtMs = event.timestampMs
            recentListScans.clear()
            return AutomationAnomaly(
                type = "ConversationListRefreshStorm",
                reason = "same_fingerprint=${sameFingerprint.size} window_ms=$refreshWindowMs",
            )
        }
        return null
    }

    fun reset() {
        replyContextUntilMs = 0L
        recentListScans.clear()
        recentContentChanges.clear()
        lastRefreshStormAtMs = null
        lastContentStormAtMs = null
    }

    private data class ListScanObservation(
        val timestampMs: Long,
        val fingerprint: String,
        val unreadCount: Int,
    )

    private data class ContentChangeObservation(
        val timestampMs: Long,
        val key: String,
    )

    private companion object {
        const val CONTENT_CHANGE_WINDOW_MS = 2_000L
        const val CONTENT_CHANGE_STORM_THRESHOLD = 20
        const val CONTENT_CHANGE_COOLDOWN_MS = 5_000L
    }
}
