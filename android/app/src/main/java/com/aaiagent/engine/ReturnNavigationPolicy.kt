package com.aaiagent.engine

import com.aaiagent.engine.observability.AutomationPageKind

object ReturnNavigationPolicy {
    fun shouldPressBackFirst(
        inChat: Boolean,
        pageKind: AutomationPageKind,
    ): Boolean {
        return inChat ||
            pageKind == AutomationPageKind.PROFILE_PAGE ||
            pageKind == AutomationPageKind.UNKNOWN
    }
}
