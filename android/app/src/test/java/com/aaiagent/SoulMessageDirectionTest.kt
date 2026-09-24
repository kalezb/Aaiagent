package com.aaiagent

import com.aaiagent.adapter.SoulMessageDirection
import org.junit.Assert.assertEquals
import org.junit.Test

class SoulMessageDirectionTest {
    @Test
    fun `read receipt identifies self messages without avatar ids`() {
        assertEquals(
            "self",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = true,
                avatarCenterX = 980,
                contentCenterX = 700,
                screenWidth = 1080
            )
        )
    }

    @Test
    fun `left avatar identifies incoming messages`() {
        assertEquals(
            "other",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = false,
                avatarCenterX = 97,
                contentCenterX = 350,
                screenWidth = 1080
            )
        )
    }

    @Test
    fun `right avatar identifies self messages`() {
        assertEquals(
            "self",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = false,
                avatarCenterX = 983,
                contentCenterX = 750,
                screenWidth = 1080
            )
        )
    }

    @Test
    fun `left avatar wins over a false read receipt marker`() {
        assertEquals(
            "other",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = true,
                avatarCenterX = 97,
                contentCenterX = 350,
                screenWidth = 1080
            )
        )
    }

    @Test
    fun `content position is the final layout fallback`() {
        assertEquals(
            "self",
            SoulMessageDirection.resolve(
                isSelfAvatar = false,
                isOtherAvatar = false,
                hasReadReceipt = false,
                avatarCenterX = null,
                contentCenterX = 700,
                screenWidth = 1080
            )
        )
    }
}
