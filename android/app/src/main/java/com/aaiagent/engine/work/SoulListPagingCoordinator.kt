package com.aaiagent.engine.work

import kotlinx.coroutines.delay

/**
 * 协调 Soul 消息列表的翻页节奏。
 *
 * 2026-11-01 用户确认的规矩：
 * 1. 当前这一屏还有能回的人，就先回，绝不往下翻。
 * 2. 这一屏确实没活干了（没红点，或红点的人被后台过滤/正在冷却），才往下翻一屏。
 * 3. 连着翻 2 屏都没回到任何人，就停下来：滑回最上面，安静一阵，等有新消息再说。
 *    （以前是翻 8 屏，用户嫌太多。）
 * 4. 只要中间回掉一个人就重新计数，所以这一屏有人可回时仍然能一路往下走，
 *    不会因为"翻了两屏"就把后面的人永远跳过。
 * 5. 划不动（已经到底或已经到顶）就当作翻到头了，回顶部收工，不反复空滑。
 * 6. 用户手指还在屏幕上时不翻页。
 */
class SoulListPagingCoordinator(
    private val maxBlindScrolls: Int = 2,
    private val scrollSettleDelayMs: Long = 600L,
    private val restAfterBlindSweepMs: Long = 60_000L,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** 连着翻了几屏还没回到人。回到人立刻清零。 */
    var blindScrolls: Int = 0
        private set

    /** 当前从列表顶部往下翻了几屏，用来判断要不要先回顶部。 */
    var scrollDownPages: Int = 0
        private set

    /** 盲翻用光以后，安静等待到什么时候。 */
    var restUntilMs: Long = 0L
        private set

    fun onConversationHandled() {
        blindScrolls = 0
        restUntilMs = 0L
    }

    fun isResting(nowMs: Long = clock()): Boolean = nowMs < restUntilMs

    fun shouldExploreNextPage(
        isInMessageList: Boolean,
        hasTabUnread: Boolean,
        nowMs: Long = clock(),
    ): Boolean {
        if (!isInMessageList || !hasTabUnread) return false
        return !isResting(nowMs)
    }

    /**
     * 只在"这一屏已经没活干"时调用。
     *
     * @return 是否真的动过屏幕（翻页或回顶部）。调用方据此决定下一次多快再看。
     */
    suspend fun exploreNextPage(
        isInMessageList: Boolean,
        hasTabUnread: Boolean,
        scrollDownAction: suspend () -> Boolean,
        scrollToTopAction: suspend () -> Boolean,
    ): Boolean {
        if (!isInMessageList) return false
        val nowMs = clock()
        clearFinishedRest(nowMs)
        if (isResting(nowMs)) return false

        if (!hasTabUnread) {
            // 红点全清了：回到最上面，下一轮从第一屏开始看。
            return if (scrollDownPages > 0) resetToTop(true, scrollToTopAction) else false
        }

        if (blindScrolls >= maxBlindScrolls) {
            // 连着翻了两屏都没回到人：别瞎滑了，回顶部歇着。
            restUntilMs = clock() + restAfterBlindSweepMs
            resetToTop(true, scrollToTopAction)
            return true
        }

        val scrolled = scrollDownAction()
        if (!scrolled) {
            // 到底了、划不动：回顶部歇着，不反复空滑。
            restUntilMs = clock() + restAfterBlindSweepMs
            resetToTop(true, scrollToTopAction)
            return true
        }

        blindScrolls++
        scrollDownPages++
        if (scrollSettleDelayMs > 0) delay(scrollSettleDelayMs)
        return true
    }

    /** 一路滑回最上面。 */
    suspend fun resetToTop(
        isInMessageList: Boolean,
        scrollToTopAction: suspend () -> Boolean,
    ): Boolean {
        if (!isInMessageList) return false
        val scrolled = scrollToTopAction()
        scrollDownPages = 0
        blindScrolls = 0
        if (scrollSettleDelayMs > 0) delay(scrollSettleDelayMs)
        return scrolled
    }

    fun reset() {
        blindScrolls = 0
        scrollDownPages = 0
        restUntilMs = 0L
    }

    /** 歇够了就开新的一轮，重新给两次盲翻机会。 */
    private fun clearFinishedRest(nowMs: Long) {
        if (restUntilMs > 0L && nowMs >= restUntilMs) {
            restUntilMs = 0L
            blindScrolls = 0
        }
    }
}
