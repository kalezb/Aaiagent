package com.aaiagent

import com.aaiagent.adapter.SoulChatTitleCandidate
import com.aaiagent.adapter.SoulChatTitlePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulChatTitlePolicyTest {
    @Test
    fun `top bar title wins when card titles appear first`() {
        val title = SoulChatTitlePolicy.choose(
            candidates = listOf(
                SoulChatTitleCandidate(
                    text = "Ta的引力签：自由、足球、二次元",
                    top = 645,
                    insideTopBar = false,
                    insideCardDescription = true
                ),
                SoulChatTitleCandidate(
                    text = "青山.",
                    top = 199,
                    insideTopBar = true,
                    insideCardDescription = false
                )
            ),
            screenHeight = 2712
        )

        assertEquals("青山.", title)
    }

    @Test
    fun `card title is ignored while top bar is loading`() {
        val title = SoulChatTitlePolicy.choose(
            candidates = listOf(
                SoulChatTitleCandidate(
                    text = "Ta的认证：",
                    top = 645,
                    insideTopBar = false,
                    insideCardDescription = true
                )
            ),
            screenHeight = 2712
        )

        assertNull(title)
    }

    @Test
    fun `unannotated title in top region remains supported`() {
        val title = SoulChatTitlePolicy.choose(
            candidates = listOf(
                SoulChatTitleCandidate(
                    text = "晚风温柔志",
                    top = 260,
                    insideTopBar = false,
                    insideCardDescription = false
                ),
                SoulChatTitleCandidate(
                    text = "你们的共同点：重庆",
                    top = 882,
                    insideTopBar = false,
                    insideCardDescription = true
                )
            ),
            screenHeight = 2712
        )

        assertEquals("晚风温柔志", title)
    }
}
