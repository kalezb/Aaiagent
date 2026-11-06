package com.aaiagent

import com.aaiagent.engine.work.SoulListPagingCoordinator
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 翻页规矩（2026-11-01 用户确认）：
 * 这一屏没活干才翻；连着翻两屏没回到人就回顶部歇着；回掉一个人就重新计数。
 */
class SoulListPagingCoordinatorTest {

    private fun coordinator(
        maxBlindScrolls: Int = 2,
        nowMs: () -> Long = { 0L },
    ) = SoulListPagingCoordinator(
        maxBlindScrolls = maxBlindScrolls,
        scrollSettleDelayMs = 0L,
        restAfterBlindSweepMs = 60_000L,
        clock = nowMs,
    )

    @Test
    fun `不在消息列表时一下都不滑`() = runBlocking {
        val coordinator = coordinator()
        var downs = 0
        var ups = 0

        val scrolled = coordinator.exploreNextPage(
            isInMessageList = false,
            hasTabUnread = true,
            scrollDownAction = { downs++; true },
            scrollToTopAction = { ups++; true },
        )

        assertFalse(scrolled)
        assertEquals(0, downs)
        assertEquals(0, ups)
    }

    @Test
    fun `连着翻两屏都没回人就停下并回最上面`() = runBlocking {
        val coordinator = coordinator()
        var downs = 0
        var ups = 0

        assertTrue(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(1, downs)
        assertTrue(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(2, downs)

        // 第三下不再往下翻，而是滑回最上面歇着
        assertTrue(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(2, downs)
        assertEquals(1, ups)
        assertTrue(coordinator.isResting())
    }

    @Test
    fun `歇着的时候一下都不滑`() = runBlocking {
        val coordinator = coordinator()
        var downs = 0
        var ups = 0

        repeat(2) {
            coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        }
        coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        assertEquals(2, downs)
        assertEquals(1, ups)

        assertFalse(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(2, downs)
        assertEquals(1, ups)
        assertFalse(coordinator.shouldExploreNextPage(true, true))
    }

    @Test
    fun `回掉一个人以后重新获得两次盲翻机会`() = runBlocking {
        val coordinator = coordinator()
        var downs = 0
        var ups = 0

        repeat(2) {
            coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        }
        coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        assertTrue(coordinator.isResting())

        coordinator.onConversationHandled()
        assertFalse(coordinator.isResting())

        assertTrue(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(3, downs)
    }

    @Test
    fun `歇够以后自动开新的一轮`() = runBlocking {
        var now = 0L
        val coordinator = coordinator(nowMs = { now })
        var downs = 0
        var ups = 0

        repeat(2) {
            coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        }
        coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true })
        assertEquals(2, downs)

        now += 61_000L
        assertFalse(coordinator.isResting(now))

        assertTrue(coordinator.exploreNextPage(true, true, { downs++; true }, { ups++; true }))
        assertEquals(3, downs)
    }

    @Test
    fun `列表到底划不动就回顶部歇着`() = runBlocking {
        val coordinator = coordinator()
        var ups = 0

        val scrolled = coordinator.exploreNextPage(true, true, { false }, { ups++; true })

        assertTrue(scrolled)
        assertEquals(1, ups)
        assertTrue(coordinator.isResting())
    }

    @Test
    fun `红点全清空以后从第二屏回到顶部`() = runBlocking {
        val coordinator = coordinator()
        var ups = 0

        coordinator.exploreNextPage(true, true, { true }, { ups++; true })
        assertEquals(1, coordinator.scrollDownPages)

        val scrolled = coordinator.exploreNextPage(true, false, { true }, { ups++; true })

        assertTrue(scrolled)
        assertEquals(1, ups)
        assertEquals(0, coordinator.scrollDownPages)
    }

    @Test
    fun `已经在第一屏且红点清空时不乱滑`() = runBlocking {
        val coordinator = coordinator()
        var downs = 0
        var ups = 0

        val scrolled = coordinator.exploreNextPage(true, false, { downs++; true }, { ups++; true })

        assertFalse(scrolled)
        assertEquals(0, downs)
        assertEquals(0, ups)
    }

    @Test
    fun `shouldExploreNextPage 只在有红点且没歇着时才为真`() {
        val coordinator = coordinator()

        assertFalse(coordinator.shouldExploreNextPage(isInMessageList = false, hasTabUnread = true))
        assertFalse(coordinator.shouldExploreNextPage(isInMessageList = true, hasTabUnread = false))
        assertTrue(coordinator.shouldExploreNextPage(isInMessageList = true, hasTabUnread = true))
    }

    @Test
    fun `reset 会把歇着和计数全部清掉`() = runBlocking {
        val coordinator = coordinator()
        repeat(2) { coordinator.exploreNextPage(true, true, { true }, { true }) }
        coordinator.exploreNextPage(true, true, { true }, { true })
        assertTrue(coordinator.isResting())

        coordinator.reset()

        assertFalse(coordinator.isResting())
        assertEquals(0, coordinator.blindScrolls)
        assertEquals(0, coordinator.scrollDownPages)
    }
}
