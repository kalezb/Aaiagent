package com.aaiagent

import com.aaiagent.engine.ChatVerificationAction
import com.aaiagent.engine.ChatVerificationPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatVerificationPolicyTest {

    @Test
    fun `missing target app aborts without sending back`() {
        assertEquals(
            ChatVerificationAction.ABORT,
            ChatVerificationPolicy.decide(
                targetPackageForeground = false,
                inChat = false,
                expectedContactName = "小明",
                actualTitle = null
            )
        )
        assertFalse(
            ChatVerificationPolicy.canPressBack(
                targetPackageForeground = false,
                inChat = false
            )
        )
    }

    @Test
    fun `waiting page retries instead of pressing back`() {
        assertEquals(
            ChatVerificationAction.RETRY,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = false,
                expectedContactName = "小明",
                actualTitle = null
            )
        )
        assertFalse(
            ChatVerificationPolicy.canPressBack(
                targetPackageForeground = true,
                inChat = false
            )
        )
    }

    @Test
    fun `wrong chat may return to the list`() {
        assertEquals(
            ChatVerificationAction.BACK_TO_LIST,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = true,
                expectedContactName = "小明",
                actualTitle = "小红"
            )
        )
        assertTrue(
            ChatVerificationPolicy.canPressBack(
                targetPackageForeground = true,
                inChat = true
            )
        )
    }

    @Test
    fun `temporary missing title retries`() {
        assertEquals(
            ChatVerificationAction.RETRY,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = true,
                expectedContactName = "小明",
                actualTitle = null
            )
        )
    }

    @Test
    fun `verified title accepts safe suffix`() {
        assertEquals(
            ChatVerificationAction.VERIFIED,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = true,
                expectedContactName = "小明",
                actualTitle = "小明 在线"
            )
        )
    }

    @Test
    fun `typing title does not trigger back when it is a transient chat status`() {
        assertEquals(
            ChatVerificationAction.RETRY,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = true,
                expectedContactName = "博大精深的小福泥",
                actualTitle = "正在输入"
            )
        )
    }

    @Test
    fun `already confirmed same chat stays verified when typing replaces the title`() {
        assertEquals(
            ChatVerificationAction.VERIFIED,
            ChatVerificationPolicy.decide(
                targetPackageForeground = true,
                inChat = true,
                expectedContactName = "博大精深的小福泥",
                actualTitle = "正在输入",
                identityConfirmed = true,
            )
        )
    }
}
