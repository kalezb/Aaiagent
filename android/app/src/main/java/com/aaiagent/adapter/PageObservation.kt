package com.aaiagent.adapter

import com.aaiagent.engine.observability.AutomationPageKind

data class PageObservation(
    val kind: AutomationPageKind,
    val contactName: String = "",
    val reason: String = "",
) {
    val isChat: Boolean get() = kind == AutomationPageKind.VERIFIED_CHAT
    val isMessageList: Boolean get() = kind == AutomationPageKind.CONVERSATION_LIST
    val isProfile: Boolean get() = kind == AutomationPageKind.PROFILE_PAGE
}

data class PageObservationSignals(
    val inChat: Boolean,
    val inMessageList: Boolean,
    val hasChatInput: Boolean,
    val hasChatTitle: Boolean,
    val profileMarkerCount: Int,
    val profileName: String = "",
    val chatTitle: String = "",
    val windowClassName: String = "",
)

object PageObservationPolicy {
    fun classify(signals: PageObservationSignals): PageObservation {
        val profile = SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
            profileMarkerCount = signals.profileMarkerCount,
            hasChatInput = signals.hasChatInput,
            hasChatTitle = signals.hasChatTitle,
            windowClassName = signals.windowClassName,
        )
        if (profile) {
            return PageObservation(
                kind = AutomationPageKind.PROFILE_PAGE,
                contactName = signals.profileName,
                reason = "profile markers=${signals.profileMarkerCount} window=${signals.windowClassName}",
            )
        }
        if (signals.inChat) {
            return PageObservation(
                kind = AutomationPageKind.VERIFIED_CHAT,
                contactName = signals.chatTitle,
                reason = "chat surface",
            )
        }
        if (signals.inMessageList) {
            return PageObservation(
                kind = AutomationPageKind.CONVERSATION_LIST,
                reason = "conversation list surface",
            )
        }
        return PageObservation(
            kind = AutomationPageKind.UNKNOWN,
            reason = "no stable page marker",
        )
    }
}
