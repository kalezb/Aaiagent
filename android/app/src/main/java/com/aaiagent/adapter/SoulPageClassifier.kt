package com.aaiagent.adapter

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

object SoulPageClassifier {
    private const val PREFIX = "cn.soulapp.android:id/"

    fun classify(
        root: AccessibilityNodeInfo?,
        inChat: Boolean,
        inMessageList: Boolean,
        windowClassName: String = "",
    ): PageObservation {
        if (root == null || root.packageName?.toString() != "cn.soulapp.android") {
            return PageObservation(
                kind = com.aaiagent.engine.observability.AutomationPageKind.UNKNOWN,
                reason = "not soul root",
            )
        }
        val profileWindow = SoulProfileSurfacePolicy.isProfileWindow(windowClassName)
        val id = { name: String ->
            root.findAccessibilityNodeInfosByViewId(PREFIX + name)
        }
        val markerCount = { name: String ->
            id(name).count { node -> profileWindow || isVisibleMarker(node) }
        }
        val input = id("et_sendmessage").isNotEmpty()
        val chatTitle = id("tv_title").firstOrNull()?.text?.toString().orEmpty()
        val profileMarkers = markerCount("user_match") +
            markerCount("user_match_text") +
            markerCount("collect_level_text") +
            markerCount("tv_chat_secret") +
            markerCount("titlebar_text_tv") +
            markerCount("c_usr_user_info_behavior_container") +
            markerCount("c_usr_user_all_list") +
            markerCount("iv_guide_user_share") +
            markerCount("v_profile_bg") +
            markerCount("avatar_area") +
            markerCount("follow_count_text")
        val profileName = id("tv_me_sign").firstOrNull()?.text?.toString().orEmpty()
            .ifBlank { id("titlebar_text_tv").firstOrNull()?.text?.toString().orEmpty() }
        return PageObservationPolicy.classify(
            PageObservationSignals(
                inChat = inChat,
                inMessageList = inMessageList,
                hasChatInput = input,
                hasChatTitle = chatTitle.isNotBlank(),
                profileMarkerCount = profileMarkers,
                profileName = profileName,
                chatTitle = chatTitle,
                windowClassName = windowClassName,
            )
        )
    }

    private fun isVisibleMarker(node: AccessibilityNodeInfo): Boolean {
        if (!node.isVisibleToUser) return false
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        return bounds.width() > 0 && bounds.height() > 0
    }
}
