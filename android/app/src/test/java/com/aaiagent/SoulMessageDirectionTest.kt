package com.aaiagent

import com.aaiagent.adapter.SoulMessageDirection
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMessageDirectionTest {
    @Test
    fun `snap roots decide the direction before geometry`() {
        // 她自己发的闪照：即使几何推断会落到 other，也必须判成 self
        assertEquals(
            "self",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = false,
                avatarCenterX = null,
                contentCenterX = 200,
                screenWidth = 1080,
                isSentSnap = true,
            ),
        )
        assertEquals(
            "other",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = false,
                avatarCenterX = null,
                contentCenterX = 900,
                screenWidth = 1080,
                isReceivedSnap = true,
            ),
        )
    }

    @Test
    fun `avatars still win for normal bubbles`() {
        assertEquals(
            "self",
            SoulMessageDirection.resolve(true, false, false, null, null, 1080),
        )
        assertEquals(
            "other",
            SoulMessageDirection.resolve(false, true, false, null, null, 1080),
        )
    }
}
