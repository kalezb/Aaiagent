package com.aaiagent

import com.aaiagent.engine.observability.AutomationPageKind
import com.aaiagent.engine.work.ConversationEntryCoordinator
import com.aaiagent.engine.work.ConversationEntryOutcome
import com.aaiagent.engine.work.ConversationEntryState
import com.aaiagent.engine.work.ConversationIdentity
import com.aaiagent.engine.work.ConversationOpenResult
import com.aaiagent.engine.work.ConversationReadResult
import com.aaiagent.engine.work.ConversationSendResult
import com.aaiagent.engine.work.ConversationUiContract
import com.aaiagent.engine.work.ConversationUiSnapshot
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationEntryCoordinatorTest {
    @Test
    fun `visible unread is opened and exact verified before handoff`() = runBlocking {
        val ui = FakeEntryUi()
        val coordinator = ConversationEntryCoordinator(ui = ui)

        val outcome = coordinator.openVisibleNext()

        assertTrue(outcome is ConversationEntryOutcome.Opened)
        val opened = outcome as ConversationEntryOutcome.Opened
        assertEquals("小王", opened.identity.displayName)
        assertEquals(ConversationEntryState.VERIFIED, opened.task.state)
        assertEquals(1, ui.openCalls)
        assertEquals(1, ui.verifyCalls)
        assertEquals(0, ui.sendCalls)

        coordinator.markComplete(opened.identity.key)
        val again = coordinator.openVisibleNext()
        assertEquals(ConversationEntryOutcome.NoWork, again)
        assertEquals(1, ui.openCalls)
    }

    @Test
    fun `candidate filter is checked before any real click`() = runBlocking {
        val ui = FakeEntryUi()
        val coordinator = ConversationEntryCoordinator(ui = ui)

        val outcome = coordinator.openVisibleNext(candidateFilter = { false })

        assertEquals(ConversationEntryOutcome.NoWork, outcome)
        assertEquals(0, ui.openCalls)
        assertEquals(0, ui.verifyCalls)
    }


    // ============================================================
    // 防饿死回归测试（2026-10-10）
    // ============================================================

    @Test
    fun `pick contact that waited longest among multiple candidates`() = runBlocking {
        // 三个联系人，服务时间分别是：小王(0=没回过的,最优先)、小明(1)、小红(2)
        // 选中"小王"因为他的 lastServedAtMs 最小（没被回过）
        val ui = FakeMultiContactUi()
        val clock = FakeClock(1000L)
        val coordinator = ConversationEntryCoordinator(ui = ui, clock = clock)

        // 手动伪造：小明上次在 500ms 前被回过，小红在 900ms 前被回过
        // 小王没被回过（lastServedAtMs 里没有他）
        // 用反射或者通过先选再 complete 的方式给小明和小红设置 lastServedAtMs
        // 这里用偷懒的方式：先选一轮完成他们
        ui.nextIdentities = listOf(ui.identityXiaoMing)
        val outcomeMing = coordinator.openVisibleNext()
        assertTrue(outcomeMing is ConversationEntryOutcome.Opened)
        coordinator.markComplete((outcomeMing as ConversationEntryOutcome.Opened).identity.key)
        clock.advance(31000) // 超过 MIN_RESERVE_GAP_MS

        ui.nextIdentities = listOf(ui.identityXiaoHong)
        val outcomeHong = coordinator.openVisibleNext()
        assertTrue(outcomeHong is ConversationEntryOutcome.Opened)
        coordinator.markComplete((outcomeHong as ConversationEntryOutcome.Opened).identity.key)
        clock.advance(31000)

        // 现在三个都可见，小王从没被回过 -> 等得最久 -> 应该选中小王
        ui.nextIdentities = listOf(ui.identityWang, ui.identityXiaoMing, ui.identityXiaoHong)
        val picked = coordinator.openVisibleNext()
        assertTrue(picked is ConversationEntryOutcome.Opened)
        assertEquals("小王", (picked as ConversationEntryOutcome.Opened).identity.displayName)
    }

    @Test
    fun `just completed contact is deprioritized on next scan`() = runBlocking {
        // 刚回复完的人不能立刻又被选中
        val ui = FakeMultiContactUi()
        val clock = FakeClock(1000L)
        val coordinator = ConversationEntryCoordinator(ui = ui, clock = clock)

        // 第一轮：只有小王和小明可见，选中小王
        ui.nextIdentities = listOf(ui.identityWang, ui.identityXiaoMing)
        val first = coordinator.openVisibleNext()
        assertTrue(first is ConversationEntryOutcome.Opened)
        val firstKey = (first as ConversationEntryOutcome.Opened).identity.key
        coordinator.markComplete(firstKey)

        // 不推进时钟！MIN_RESERVE_GAP_MS = 30秒，现在才 1000ms
        // 小王在冷却中，应该选小明
        ui.nextIdentities = listOf(ui.identityWang, ui.identityXiaoMing)
        val second = coordinator.openVisibleNext()
        assertTrue(second is ConversationEntryOutcome.Opened)
        val secondKey = (second as ConversationEntryOutcome.Opened).identity.key
        assertNotEquals(firstKey, secondKey)
    }

    @Test
    fun `after cooldown expires contact can be selected again`() = runBlocking {
        // 冷却期过了以后，可以再次选中同一个人
        val ui = FakeMultiContactUi()
        val clock = FakeClock(1000L)
        val coordinator = ConversationEntryCoordinator(ui = ui, clock = clock)

        // 第一轮选中小王
        ui.nextIdentities = listOf(ui.identityWang)
        val first = coordinator.openVisibleNext()
        assertTrue(first is ConversationEntryOutcome.Opened)
        coordinator.markComplete((first as ConversationEntryOutcome.Opened).identity.key)

        // 推进 61 秒（超过 60 秒间隔）
        clock.advance(61000)
        ui.nextIdentities = listOf(ui.identityWang)
        val second = coordinator.openVisibleNext()
        assertTrue(second is ConversationEntryOutcome.Opened)
        assertEquals("小王", (second as ConversationEntryOutcome.Opened).identity.displayName)
    }

    @Test
    fun `no list position bias when all contacts have same lastServedAtMs`() = runBlocking {
        // 所有人都没被回过，随机哪个被选中都行，但不能只死盯着列表第一个
        val ui = FakeMultiContactUi()
        val clock = FakeClock(1000L)
        val coordinator = ConversationEntryCoordinator(ui = ui, clock = clock)

        // 三个都没被回过
        val allThree = listOf(ui.identityWang, ui.identityXiaoMing, ui.identityXiaoHong)
        val pickedNames = mutableSetOf<String>()

        // 跑多轮，验证不会每次都选中列表第一个人（小明在很多轮里排第一）
        repeat(20) {
            ui.nextIdentities = allThree
            val outcome = coordinator.openVisibleNext()
            if (outcome is ConversationEntryOutcome.Opened) {
                pickedNames.add(outcome.identity.displayName)
                coordinator.markComplete(outcome.identity.key)
                clock.advance(31000)
            } else if (outcome is ConversationEntryOutcome.NoWork) {
                clock.advance(31000)
            }
        }

        // 三个人的名字都应该被选过
        assertTrue(pickedNames.contains("小王"))
        assertTrue(pickedNames.contains("小明"))
        assertTrue(pickedNames.contains("小红"))
    }

    private class FakeMultiContactUi : ConversationUiContract {
        override val platform: String = "soul"
        var openCalls = 0
        var nextIdentities: List<ConversationIdentity> = emptyList()

        val identityWang = ConversationIdentity(
            platform = "soul", stableId = "soul-name:小王", displayName = "小王",
            preview = "你好", unreadCount = 1, lastMessageTime = "12:36",
        )
        val identityXiaoMing = ConversationIdentity(
            platform = "soul", stableId = "soul-name:小明", displayName = "小明",
            preview = "在吗", unreadCount = 1, lastMessageTime = "08:00",
        )
        val identityXiaoHong = ConversationIdentity(
            platform = "soul", stableId = "soul-name:小红", displayName = "小红",
            preview = "哈哈", unreadCount = 1, lastMessageTime = "16:39",
        )

        override fun snapshot() = ConversationUiSnapshot(
            platform = platform, pageKind = AutomationPageKind.CONVERSATION_LIST,
            reason = "消息列表", capturedAtMs = 1L,
        )

        override suspend fun scanUnread(maxEntries: Int): List<ConversationIdentity> = nextIdentities
        override suspend fun scanVisibleUnread(maxEntries: Int): List<ConversationIdentity> = nextIdentities

        override suspend fun openConversation(identity: ConversationIdentity): ConversationOpenResult {
            openCalls += 1
            return ConversationOpenResult(opened = true, verifiedIdentity = identity, reason = "ok")
        }

        override fun verifyConversation(expected: ConversationIdentity): ConversationOpenResult =
            ConversationOpenResult(opened = true, verifiedIdentity = expected, reason = "一致")

        override fun readLatestMessages(): ConversationReadResult =
            ConversationReadResult(read = false, reason = "入口不读")

        override suspend fun sendText(text: String, operationId: String): ConversationSendResult =
            ConversationSendResult(sent = true, verified = true)

        override suspend fun returnToMessageList(): Boolean = true
    }

    private class FakeClock(private var nowMs: Long) : () -> Long {
        override fun invoke(): Long = nowMs
        fun advance(deltaMs: Long) { nowMs += deltaMs }
    }

    private class FakeEntryUi : ConversationUiContract {
        override val platform: String = "soul"
        var openCalls = 0
        var verifyCalls = 0
        var sendCalls = 0

        override fun snapshot() = ConversationUiSnapshot(
            platform = platform,
            pageKind = AutomationPageKind.CONVERSATION_LIST,
            reason = "消息列表",
            capturedAtMs = 1L,
        )

        override suspend fun scanUnread(maxEntries: Int): List<ConversationIdentity> {
            error("真实接管入口只能看当前可见未读，不能先滚动整页")
        }

        override suspend fun scanVisibleUnread(
            maxEntries: Int,
        ): List<ConversationIdentity> = listOf(identity)

        override suspend fun openConversation(
            identity: ConversationIdentity,
        ): ConversationOpenResult {
            openCalls += 1
            return ConversationOpenResult(
                opened = true,
                verifiedIdentity = identity,
                reason = "点击成功",
            )
        }

        override fun verifyConversation(
            expected: ConversationIdentity,
        ): ConversationOpenResult {
            verifyCalls += 1
            return ConversationOpenResult(
                opened = true,
                verifiedIdentity = expected,
                reason = "标题一致",
            )
        }

        override fun readLatestMessages(): ConversationReadResult =
            ConversationReadResult(read = false, reason = "入口阶段不读消息")

        override suspend fun sendText(
            text: String,
            operationId: String,
        ): ConversationSendResult {
            sendCalls += 1
            return ConversationSendResult(sent = true, verified = true)
        }

        override suspend fun returnToMessageList(): Boolean = true

        private companion object {
            val identity = ConversationIdentity(
                platform = "soul",
                stableId = "soul-name:小王",
                displayName = "小王",
                preview = "你好",
                unreadCount = 1,
            )
        }
    }
}
