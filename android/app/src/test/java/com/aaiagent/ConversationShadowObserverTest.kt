package com.aaiagent

import com.aaiagent.engine.work.ConversationIdentity
import com.aaiagent.engine.work.ConversationOrchestrationOutcome
import com.aaiagent.engine.work.ConversationShadowObserver
import com.aaiagent.engine.work.ConversationShadowProbe
import com.aaiagent.engine.work.ConversationWorkItem
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationShadowObserverTest {
    @Test
    fun `one unread decision is reported once inside the repeat window`() = runBlocking {
        var nowMs = 1_000L
        val reports = mutableListOf<String>()
        val observer = ConversationShadowObserver(
            probe = ConversationShadowProbe {
                shadowDecision(nowMs)
            },
            report = { _, detail -> reports += detail },
            clock = { nowMs },
            repeatWindowMs = 10_000L,
        )

        observer.observeOnce()
        nowMs += 2_000L
        observer.observeOnce()
        nowMs += 11_000L
        observer.observeOnce()

        assertEquals(2, reports.size)
        assertTrue(reports.first().contains("建议打开=小王"))
        assertTrue(reports.first().contains("不点击"))
    }

    @Test
    fun `risk overlay is recorded but no work produces no journal noise`() = runBlocking {
        val reports = mutableListOf<String>()
        var outcome: ConversationOrchestrationOutcome =
            ConversationOrchestrationOutcome.RiskOverlay(
                reason = "SOUL_MOMENT_POST_RISK_DIALOG",
                recoveryAction = "返回消息列表",
                acted = false,
            )
        val observer = ConversationShadowObserver(
            probe = ConversationShadowProbe { outcome },
            report = { _, detail -> reports += detail },
            clock = { 1_000L },
        )

        observer.observeOnce()
        outcome = ConversationOrchestrationOutcome.NoUnreadWork
        observer.observeOnce()

        assertEquals(1, reports.size)
        assertTrue(reports.single().contains("风险弹窗"))
        assertTrue(reports.single().contains("已执行=false"))
    }

    private fun shadowDecision(nowMs: Long): ConversationOrchestrationOutcome.ShadowDecision {
        val identity = ConversationIdentity(
            platform = "soul",
            stableId = "soul-name:小王",
            displayName = "小王",
            preview = "你好",
            unreadCount = 1,
        )
        return ConversationOrchestrationOutcome.ShadowDecision(
            identity = identity,
            item = ConversationWorkItem(
                identity = identity,
                discoveredAtMs = nowMs,
            ),
            plannedAction = "OPEN",
            reason = "影子模式",
        )
    }
}
