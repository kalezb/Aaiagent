package com.aaiagent

import com.aaiagent.adapter.SoulVoiceDelivery
import com.aaiagent.adapter.SoulVoiceRecordPolicy.PanelState
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 语音发送流程的分支测试。
 *
 * 重点不是"顺利发出"，而是每种出错的收尾：**绝不能把还在录音的面板留给下一轮**。
 */
class SoulVoiceDeliveryTest {

    /** 假时钟：录制时长的核对靠它，测试里就能精确控制"实际录了多久"。 */
    private class FakeClock(var now: Long = 1_000_000L) {
        fun advance(ms: Long) {
            now += ms
        }
    }

    private class FakeScreen(val clock: FakeClock = FakeClock()) : SoulVoiceDelivery.SoulVoiceScreen {
        var state = PanelState.ABSENT
        var openResult = true
        var startRecording = true
        var pauseResult = true
        var pauseApplies = true

        /**
         * 点暂停时时钟额外走多久。
         * 正数 = 真实点按延迟（正常）；负得太多 = 提前暂停了，配音尾巴没录进去。
         */
        var pauseLatencyMs = 300L

        var sendResult = true
        var closesAfterSend = true
        var afterPause: (() -> Unit)? = null

        /**
         * 等界面确认"已暂停"要花多久。
         *
         * **它不该被算进录制时长** —— 录了多久是"停手那一刻"决定的，
         * 跟界面什么时候反应过来无关。
         */
        var settleLatencyMs = 0L

        val calls = mutableListOf<String>()

        override suspend fun openRecorder(): Boolean {
            calls += "open"
            if (openResult && startRecording) state = PanelState.RECORDING
            return openResult
        }

        override fun panelState(): PanelState = state

        override fun tapPause(): Boolean {
            calls += "pause"
            clock.advance(pauseLatencyMs)
            if (!pauseResult) return false
            if (pauseApplies) state = PanelState.PAUSED
            afterPause?.invoke()
            return true
        }

        override fun tapSend(): Boolean {
            calls += "send"
            if (!sendResult) return false
            if (closesAfterSend) state = PanelState.ABSENT
            return true
        }

        override fun tapCancel(): Boolean {
            calls += "cancel"
            state = PanelState.ABSENT
            return true
        }

        override suspend fun awaitPanelState(state: PanelState, timeoutMs: Long): Boolean {
            if (state == PanelState.PAUSED) clock.advance(settleLatencyMs)
            return this.state == state
        }

        override suspend fun awaitPanelClosed(timeoutMs: Long): Boolean =
            state == PanelState.ABSENT
    }

    private fun deliver(
        screen: FakeScreen,
        audioDurationMs: Long = 5_000L,
        canProceed: () -> Boolean = { true },
    ): SoulVoiceDelivery.Result = runBlocking {
        SoulVoiceDelivery(
            screen,
            // 测试里不真的等，但要让时钟跟着走 —— 录制时长就是这么测出来的。
            wait = { screen.clock.advance(it) },
            now = { screen.clock.now },
        ).recordAndSend(audioDurationMs, canProceed)
    }

    // ---- 顺利那条路 ----

    @Test
    fun `happy path records pauses and sends`() {
        val screen = FakeScreen()
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.SENT, result.status)
        // 目标时长 = 5000 + 启动余量 400 + 收尾余量 350 = 5750ms，再加 300ms 点按延迟 ≈ 6 秒
        assertEquals(6, result.recordedSeconds)
        assertEquals(listOf("open", "pause", "send"), screen.calls)
        assertEquals(PanelState.ABSENT, screen.state)
    }

    // ---- 开录音阶段 ----

    @Test
    fun `dub longer than one recording is refused before touching the screen`() {
        val screen = FakeScreen()
        val result = deliver(screen, audioDurationMs = 70_000L)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("audio_too_long_for_one_message", result.reason)
        assertTrue("不应该碰屏幕", screen.calls.isEmpty())
    }

    @Test
    fun `non positive duration is refused`() {
        val screen = FakeScreen()
        val result = deliver(screen, audioDurationMs = 0L)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("invalid_duration", result.reason)
        assertTrue(screen.calls.isEmpty())
    }

    @Test
    fun `recorder that will not open is reported`() {
        val screen = FakeScreen().apply { openResult = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("recorder_open_failed", result.reason)
    }

    @Test
    fun `recording that never starts is reported and leaves no panel behind`() {
        val screen = FakeScreen().apply { startRecording = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("recording_not_started", result.reason)
        assertEquals(PanelState.ABSENT, screen.state)
        assertFalse("面板本来就没开，不该点取消", screen.calls.contains("cancel"))
    }

    // ---- 录音途中的收尾 ----

    @Test
    fun `user taking the phone back while recording cancels the panel`() {
        val screen = FakeScreen()
        var checks = 0
        // 第 1 次是开录前的检查；第 2 次已经进到录音等待里了。
        val result = deliver(screen, canProceed = { ++checks <= 1 })

        assertEquals(SoulVoiceDelivery.Status.STOPPED, result.status)
        assertEquals("taken_over_while_recording", result.reason)
        assertTrue("必须把录音面板收掉", screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    // ---- 暂停阶段 ----

    @Test
    fun `pause button that does not respond leaves no open panel`() {
        val screen = FakeScreen().apply { pauseResult = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("pause_tap_failed", result.reason)
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    @Test
    fun `pause that never takes effect is reported`() {
        val screen = FakeScreen().apply { pauseApplies = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("pause_not_confirmed", result.reason)
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    // ---- 发之前的录制时长核对 ----
    //
    // 关键：核对用的是**代码自己测的墙钟时间**，不是界面上的秒数。
    // 界面上的秒数画在圆环图片里根本读不到；界面树里那个同名的 tvVoiceLength
    // 其实是聊天记录里语音气泡的时长（真机实测：气泡在就凑巧过关，气泡不在就读到空值、
    // 整条降级成文字 —— 时好时坏就是这么来的）。

    @Test
    fun `recording that ended way too early cancels instead of sending`() {
        // 提前 2 秒暂停 —— 配音尾巴根本没录进去
        val screen = FakeScreen().apply { pauseLatencyMs = -2_000L }
        val result = deliver(screen, audioDurationMs = 5_000L)

        assertEquals(SoulVoiceDelivery.Status.CANCELLED, result.status)
        assertEquals("recording_truncated", result.reason)
        assertFalse("录短了就不许发", screen.calls.contains("send"))
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    @Test
    fun `recording that hit the sixty second ceiling cancels instead of sending`() {
        // 59 秒的配音加余量已经顶到 60 秒上限，实际录到 >= 60000ms → 被硬截断
        val screen = FakeScreen().apply { pauseLatencyMs = 300L }
        val result = deliver(screen, audioDurationMs = 59_000L)

        assertEquals(SoulVoiceDelivery.Status.CANCELLED, result.status)
        assertEquals("recording_truncated", result.reason)
        assertFalse(screen.calls.contains("send"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    @Test
    fun `recording that ran far too long cancels instead of sending`() {
        // 暂停晚了 8 秒 —— 配音早放完了，后面多录了一截静音
        val screen = FakeScreen().apply { pauseLatencyMs = 8_000L }
        val result = deliver(screen, audioDurationMs = 5_000L)

        assertEquals(SoulVoiceDelivery.Status.CANCELLED, result.status)
        assertEquals("recording_mismatch", result.reason)
        assertFalse(screen.calls.contains("send"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    @Test
    fun `a normal tap latency is not treated as a mismatch`() {
        // 点按有几百毫秒延迟是正常的，实测总会比预期略长 —— 不能因此判失败
        val screen = FakeScreen().apply { pauseLatencyMs = 900L }
        val result = deliver(screen, audioDurationMs = 5_000L)

        assertEquals(SoulVoiceDelivery.Status.SENT, result.status)
    }

    @Test
    fun `user taking the phone back before sending cancels the panel`() {
        val screen = FakeScreen()
        var allow = true
        screen.afterPause = { allow = false }
        val result = deliver(screen, canProceed = { allow })

        assertEquals(SoulVoiceDelivery.Status.STOPPED, result.status)
        assertEquals("taken_over_before_send", result.reason)
        assertFalse(screen.calls.contains("send"))
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    // ---- 发送阶段 ----

    @Test
    fun `send button that does not respond leaves no open panel`() {
        val screen = FakeScreen().apply { sendResult = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("send_tap_failed", result.reason)
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    @Test
    fun `a panel that stays open after send is never reported as sent`() {
        val screen = FakeScreen().apply { closesAfterSend = false }
        val result = deliver(screen)

        assertEquals(SoulVoiceDelivery.Status.FAILED, result.status)
        assertEquals("panel_not_closed_after_send", result.reason)
        assertTrue(screen.calls.contains("cancel"))
        assertEquals(PanelState.ABSENT, screen.state)
    }

    /**
     * **界面确认"已暂停"的延迟不能算进录制时长。**
     *
     * 真机事故（2026-10-06 20:16）：点暂停是准时的（开始 + 7.5 秒），
     * 但界面确认慢了约 5 秒 —— 原来的代码量到"确认那一刻"为止，
     * 于是量出来比目标多 5 秒，正好顶到容差（5000ms）之外，
     * 判成 `recording_mismatch`、整条语音被取消、退回文字。
     *
     * 录了多久是"停手那一刻"决定的，跟界面什么时候反应过来无关。
     */
    @Test
    fun `a slow pause confirmation does not fail the recording length check`() {
        val screen = FakeScreen().apply { settleLatencyMs = 5_200L }
        val result = deliver(screen, audioDurationMs = 5_000L)

        assertEquals(SoulVoiceDelivery.Status.SENT, result.status)
    }

    @Test
    fun `a genuinely too short recording is still rejected`() {
        // 反向保护：改完量时间点之后，"真的录少了"仍然必须拦住
        // （配音尾巴没录进去，发出去会缺字）。
        val screen = FakeScreen().apply { pauseLatencyMs = -3_000L }
        val result = deliver(screen, audioDurationMs = 5_000L)

        assertEquals(SoulVoiceDelivery.Status.CANCELLED, result.status)
        assertEquals("recording_truncated", result.reason)
    }
}
