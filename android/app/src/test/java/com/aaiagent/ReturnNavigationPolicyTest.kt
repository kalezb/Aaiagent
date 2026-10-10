package com.aaiagent

import com.aaiagent.engine.ReturnNavigationPolicy
import com.aaiagent.engine.observability.AutomationPageKind
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReturnNavigationPolicyTest {
    @Test
    fun `chat profile and unknown pages always use a safety back first`() {
        assertTrue(
            ReturnNavigationPolicy.shouldPressBackFirst(
                inChat = true,
                pageKind = AutomationPageKind.VERIFIED_CHAT,
            )
        )
        assertTrue(
            ReturnNavigationPolicy.shouldPressBackFirst(
                inChat = false,
                pageKind = AutomationPageKind.PROFILE_PAGE,
            )
        )
        assertTrue(
            ReturnNavigationPolicy.shouldPressBackFirst(
                inChat = false,
                pageKind = AutomationPageKind.UNKNOWN,
            )
        )
        assertFalse(
            ReturnNavigationPolicy.shouldPressBackFirst(
                inChat = false,
                pageKind = AutomationPageKind.CONVERSATION_LIST,
            )
        )
    }
}
