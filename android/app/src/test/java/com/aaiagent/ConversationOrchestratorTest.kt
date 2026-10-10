package com.aaiagent

import com.aaiagent.engine.observability.AutomationPageKind
import com.aaiagent.engine.work.ConversationIdentity
import com.aaiagent.engine.work.ConversationOpenResult
import com.aaiagent.engine.work.ConversationOrchestrationOutcome
import com.aaiagent.engine.work.ConversationOrchestrator
import com.aaiagent.engine.work.ConversationReadResult
import com.aaiagent.engine.work.ConversationReplyPlan
import com.aaiagent.engine.work.ConversationReplyPlanner
import com.aaiagent.engine.work.ConversationSendResult
import com.aaiagent.engine.work.ConversationUiContract
import com.aaiagent.engine.work.ConversationUiMessage
import com.aaiagent.engine.work.ConversationUiSnapshot
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationOrchestratorTest {
    @Test
    fun `shadow mode only decides who to open`() = runBlocking {
        val ui = FakeConversationUi()
        val orchestrator = ConversationOrchestrator(
            ui = ui,
            planner = planner("第一段", "第二段"),
            shadowMode = true,
        )

        val outcome = orchestrator.processNext()

        assertTrue(outcome is ConversationOrchestrationOutcome.ShadowDecision)
        assertEquals(0, ui.openCalls)
        assertEquals(0, ui.sendCalls)
        assertEquals(0, orchestrator.taskSnapshot().size)
        assertEquals(1, ui.visibleScanCalls)
        assertEquals(0, ui.fullScanCalls)
    }

    @Test
    fun `normal mode follows open verify read send return order`() = runBlocking {
        val ui = FakeConversationUi()
        val orchestrator = ConversationOrchestrator(
            ui = ui,
            planner = planner(" 第一段 ", "第二段"),
            shadowMode = false,
        )

        val outcome = orchestrator.processNext()

        assertTrue(outcome is ConversationOrchestrationOutcome.Completed)
        val completed = outcome as ConversationOrchestrationOutcome.Completed
        assertEquals(2, completed.replyParts)
        assertEquals(listOf("第一段", "第二段"), ui.sentTexts)
        assertEquals(1, ui.openCalls)
        assertEquals(1, ui.verifyCalls)
        assertEquals(1, ui.readCalls)
        assertEquals(1, ui.returnCalls)
        assertTrue(orchestrator.taskSnapshot().single().isComplete)
    }

    @Test
    fun `risk overlay never clicks or sends`() = runBlocking {
        val ui = FakeConversationUi(riskOverlay = true)
        val orchestrator = ConversationOrchestrator(
            ui = ui,
            planner = planner("不该发送"),
            shadowMode = false,
        )

        val outcome = orchestrator.processNext()

        assertTrue(outcome is ConversationOrchestrationOutcome.RiskOverlay)
        val risk = outcome as ConversationOrchestrationOutcome.RiskOverlay
        assertEquals(1, ui.returnCalls)
        assertEquals(0, ui.openCalls)
        assertEquals(0, ui.sendCalls)
        assertTrue(risk.acted)
    }

    private fun planner(vararg parts: String) = ConversationReplyPlanner { _, _ ->
        ConversationReplyPlan(parts.toList(), "测试回复")
    }

    private class FakeConversationUi(
        private val riskOverlay: Boolean = false,
    ) : ConversationUiContract {
        override val platform: String = "test"
        var openCalls = 0
        var verifyCalls = 0
        var readCalls = 0
        var sendCalls = 0
        var returnCalls = 0
        var visibleScanCalls = 0
        var fullScanCalls = 0
        val sentTexts = mutableListOf<String>()

        override fun snapshot() = ConversationUiSnapshot(
            platform = platform,
            pageKind = if (riskOverlay) {
                AutomationPageKind.DIALOG
            } else {
                AutomationPageKind.CONVERSATION_LIST
            },
            reason = if (riskOverlay) "风险弹窗" else "消息列表",
            capturedAtMs = 1L,
        )

        override suspend fun scanUnread(maxEntries: Int): List<ConversationIdentity> {
            fullScanCalls += 1
            return listOf(identity)
        }

        override suspend fun scanVisibleUnread(maxEntries: Int): List<ConversationIdentity> {
            visibleScanCalls += 1
            return listOf(identity)
        }

        override suspend fun openConversation(
            identity: ConversationIdentity,
        ): ConversationOpenResult {
            openCalls += 1
            return ConversationOpenResult(true, verifiedIdentity = identity, reason = "已打开")
        }

        override fun verifyConversation(
            expected: ConversationIdentity,
        ): ConversationOpenResult {
            verifyCalls += 1
            return ConversationOpenResult(true, verifiedIdentity = expected, reason = "已确认")
        }

        override fun readLatestMessages(): ConversationReadResult {
            readCalls += 1
            return ConversationReadResult(
                read = true,
                latestIncomingFingerprint = "fp-1",
                messages = listOf(
                    ConversationUiMessage(
                        sender = "对方",
                        type = "text",
                        content = "你好",
                        identityKey = "incoming:1",
                        timestampText = "",
                    )
                ),
                reason = "读取成功",
            )
        }

        override suspend fun sendText(
            text: String,
            operationId: String,
        ): ConversationSendResult {
            sendCalls += 1
            sentTexts += text
            return ConversationSendResult(sent = true, verified = true, reason = "发送成功")
        }

        override suspend fun returnToMessageList(): Boolean {
            returnCalls += 1
            return true
        }

        override fun isRiskOverlay(observation: ConversationUiSnapshot): Boolean {
            return observation.pageKind == AutomationPageKind.DIALOG
        }

        private companion object {
            val identity = ConversationIdentity(
                platform = "test",
                stableId = "contact-1",
                displayName = "小王",
                unreadCount = 1,
            )
        }
    }
}
