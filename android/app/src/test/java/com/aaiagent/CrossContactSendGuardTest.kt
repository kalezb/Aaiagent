package com.aaiagent

import com.aaiagent.engine.CrossContactSendGuard
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CrossContactSendGuardTest {
    private val now = 1_800_000_000_000L

    @Test
    fun blocksTheSameLongLineSentToAnotherContact() {
        val recent = mutableListOf(
            CrossContactSendGuard.Sent("那可不 巧得我都有点想多聊两句了", "爱你520", now - 60_000),
        )
        assertTrue(
            CrossContactSendGuard.isCrossContactRepeat(
                "那可不 巧得我都有点想多聊两句了",
                "信仰",
                recent,
                now,
            ),
        )
    }

    @Test
    fun allowsOtherContactNameAndShortLines() {
        val recent = mutableListOf(
            CrossContactSendGuard.Sent("那可不 巧得我都有点想多聊两句了", "爱你520", now - 60_000),
        )
        assertFalse(
            CrossContactSendGuard.isCrossContactRepeat("那可不 巧得我都有点想多聊两句了", "爱你520", recent, now),
        )
        assertFalse(CrossContactSendGuard.isCrossContactRepeat("哈哈", "信仰", recent, now))
        val old = mutableListOf(
            CrossContactSendGuard.Sent("今天有点累 我先眯一会儿", "爱你520", now - 10 * 60_000),
        )
        assertFalse(CrossContactSendGuard.isCrossContactRepeat("今天有点累 我先眯一会儿", "信仰", old, now))
    }
}
