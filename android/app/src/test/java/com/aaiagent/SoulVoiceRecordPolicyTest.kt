package com.aaiagent

import com.aaiagent.adapter.SoulVoiceRecordPolicy
import com.aaiagent.adapter.SoulVoiceRecordPolicy.LengthVerdict
import com.aaiagent.adapter.SoulVoiceRecordPolicy.PanelState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulVoiceRecordPolicyTest {

    // ---- 面板状态判断 ----
    //
    // 只认中间按钮的文字。**不再拿"有没有显示时长"兜底**：
    // 那个节点的 id（tvVoiceLength）和聊天记录里语音气泡的时长重名，
    // 聊天里只要有带时长的语音气泡，就会把"根本没在录音"误判成"已经暂停"。

    @Test
    fun `recording and paused are told apart by the button label`() {
        assertEquals(
            PanelState.RECORDING,
            SoulVoiceRecordPolicy.panelState(middleButtonLabel = "暂停录音")
        )
        assertEquals(
            PanelState.PAUSED,
            SoulVoiceRecordPolicy.panelState(middleButtonLabel = "发语音")
        )
    }

    @Test
    fun `an unreadable label means no panel at all`() {
        // 读不到就老实当没有面板，调用方按失败处理 —— 那是安全的。
        // 误判成"已暂停"才会真出事：会去点一个不存在的发送按钮。
        assertEquals(PanelState.ABSENT, SoulVoiceRecordPolicy.panelState(null))
        assertEquals(PanelState.ABSENT, SoulVoiceRecordPolicy.panelState(""))
        assertEquals(PanelState.ABSENT, SoulVoiceRecordPolicy.panelState("  "))
        assertEquals(PanelState.ABSENT, SoulVoiceRecordPolicy.panelState("正在录音"))
    }

    // ---- 中间大按钮在两个状态下是两个不同节点（真机 06:57 就是在这儿翻的车）----

    @Test
    fun `recording state uses the progress ring as its action button`() {
        val ids = SoulVoiceRecordPolicy.actionButtonIds(PanelState.RECORDING)
        assertEquals("imv_bg_full_progress", ids.first())
        assertTrue(ids.contains("imvStatus"))
        // 关键断言：录音中绝不能去找暂停后才存在的那个节点，否则又会 pause_tap_failed。
        assertEquals(false, ids.contains("imvStatusPlace"))
    }

    @Test
    fun `paused state uses the send button node`() {
        assertEquals(
            listOf("imvStatusPlace"),
            SoulVoiceRecordPolicy.actionButtonIds(PanelState.PAUSED)
        )
        // 反过来也一样：暂停后进度环已经没了。
        assertEquals(false, SoulVoiceRecordPolicy.actionButtonIds(PanelState.PAUSED)
            .contains("imv_bg_full_progress"))
    }

    @Test
    fun `absent panel has no action button`() {
        assertEquals(emptyList<String>(), SoulVoiceRecordPolicy.actionButtonIds(PanelState.ABSENT))
    }

    // ---- 录音该跑多久 ----

    @Test
    fun `record duration adds start and finalize margins`() {
        assertEquals(
            5_000L + SoulVoiceRecordPolicy.START_MARGIN_MS + SoulVoiceRecordPolicy.FINALIZE_MARGIN_MS,
            SoulVoiceRecordPolicy.recordDurationMs(5_000L)
        )
    }

    @Test
    fun `record duration never goes below the floor`() {
        assertEquals(SoulVoiceRecordPolicy.MIN_RECORD_MS, SoulVoiceRecordPolicy.recordDurationMs(0L))
        assertEquals(SoulVoiceRecordPolicy.MIN_RECORD_MS, SoulVoiceRecordPolicy.recordDurationMs(-1L))
    }

    @Test
    fun `record duration is capped at the soul hard limit`() {
        assertEquals(SoulVoiceRecordPolicy.MAX_RECORD_MS, SoulVoiceRecordPolicy.recordDurationMs(120_000L))
    }

    // ---- 一条录音塞不塞得下 ----

    @Test
    fun `audio that still fits one recording is allowed`() {
        // 59.25 秒 + 余量正好顶到 60 秒，还算塞得下。
        assertEquals(false, SoulVoiceRecordPolicy.exceedsSingleRecordLimit(59_250L))
    }

    @Test
    fun `audio past the ceiling must be split`() {
        assertEquals(true, SoulVoiceRecordPolicy.exceedsSingleRecordLimit(59_251L))
        assertEquals(true, SoulVoiceRecordPolicy.exceedsSingleRecordLimit(70_000L))
    }

    // ---- 读面板上的秒数 ----

    @Test
    fun `length label is parsed from the visible seconds`() {
        assertEquals(41, SoulVoiceRecordPolicy.parseLengthSeconds("41\""))
        assertEquals(60, SoulVoiceRecordPolicy.parseLengthSeconds("60\" "))
        assertEquals(7, SoulVoiceRecordPolicy.parseLengthSeconds("7秒"))
    }

    @Test
    fun `unreadable length label yields null`() {
        assertEquals(null, SoulVoiceRecordPolicy.parseLengthSeconds(null))
        assertEquals(null, SoulVoiceRecordPolicy.parseLengthSeconds(""))
        assertEquals(null, SoulVoiceRecordPolicy.parseLengthSeconds("0\""))
        assertEquals(null, SoulVoiceRecordPolicy.parseLengthSeconds("正在录音"))
    }

    // ---- 切到语音输入态的重试上界 ----

    @Test
    fun `voice mode switching is bounded`() {
        // 打字态下要先切过去。上界钉在很小的数上，免得以后越点越多次把界面点乱。
        assertTrue(SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_ATTEMPTS in 1..3)
        assertTrue(SoulVoiceRecordPolicy.shouldKeepSwitching(0))
        assertTrue(SoulVoiceRecordPolicy.shouldKeepSwitching(SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_ATTEMPTS - 1))
        assertEquals(false, SoulVoiceRecordPolicy.shouldKeepSwitching(SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_ATTEMPTS))
        assertEquals(false, SoulVoiceRecordPolicy.shouldKeepSwitching(99))
    }

    @Test
    fun `voice mode switch waits long enough for soul to redraw`() {
        assertTrue(SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_TIMEOUT_MS in 1_000L..6_000L)
    }

    // ---- 发之前的录制时长核对 ----
    //
    // 这里核对的 expected / measured 都是**代码自己测的墙钟时间**（毫秒），
    // 不是界面上的秒数 —— 界面上的秒数画在圆环图片里读不到，
    // 界面树里同名的 tvVoiceLength 其实是聊天记录里语音气泡的时长（真机实测）。

    @Test
    fun `recording close to the target is allowed to send`() {
        val target = SoulVoiceRecordPolicy.recordDurationMs(5_000L)   // 5750
        // 点按延迟让实测略长一点，正常。
        assertEquals(LengthVerdict.OK, SoulVoiceRecordPolicy.verifyRecording(target, target + 300L))
        assertEquals(LengthVerdict.OK, SoulVoiceRecordPolicy.verifyRecording(target, target + 1_400L))
        // 略短一点也在容差内。
        assertEquals(LengthVerdict.OK, SoulVoiceRecordPolicy.verifyRecording(target, target - 1_400L))
    }

    @Test
    fun `recording that ended too early is treated as truncated`() {
        val target = SoulVoiceRecordPolicy.recordDurationMs(5_000L)   // 5750
        assertEquals(LengthVerdict.TRUNCATED, SoulVoiceRecordPolicy.verifyRecording(target, target - 2_000L))
        assertEquals(LengthVerdict.TRUNCATED, SoulVoiceRecordPolicy.verifyRecording(9_750L, 3_000L))
    }

    @Test
    fun `recording that hit the sixty second ceiling is treated as truncated`() {
        // Soul 录到 60 秒会自动暂停 —— 撞上就说明后半句没进去。
        assertEquals(LengthVerdict.TRUNCATED, SoulVoiceRecordPolicy.verifyRecording(59_750L, 60_000L))
        assertEquals(LengthVerdict.TRUNCATED, SoulVoiceRecordPolicy.verifyRecording(59_750L, 61_000L))
    }

    @Test
    fun `recording that ran far too long is a mismatch`() {
        val target = SoulVoiceRecordPolicy.recordDurationMs(5_000L)
        assertEquals(LengthVerdict.MISMATCH, SoulVoiceRecordPolicy.verifyRecording(target, target + 8_000L))
    }

    @Test
    fun `recording shorter than the minimum is refused`() {
        assertEquals(
            LengthVerdict.TRUNCATED,
            SoulVoiceRecordPolicy.verifyRecording(5_000L, SoulVoiceRecordPolicy.MIN_RECORD_MS - 1)
        )
    }

    @Test
    fun `nonsense values are refused instead of silently passing`() {
        assertEquals(LengthVerdict.UNREADABLE, SoulVoiceRecordPolicy.verifyRecording(5_000L, 0L))
        assertEquals(LengthVerdict.UNREADABLE, SoulVoiceRecordPolicy.verifyRecording(0L, 5_000L))
        assertEquals(LengthVerdict.UNREADABLE, SoulVoiceRecordPolicy.verifyRecording(-1L, -1L))
    }

    // ---- 点按安全：别误点到「取消」 ----

    /** 真机实测的取消按钮位置：(146,1952)-(332,2138)。 */
    private val cancelBounds = SoulVoiceRecordPolicy.Bounds(146, 1952, 332, 2138)

    @Test
    fun `the middle action button is a safe place to tap`() {
        // 真机实测：中间大按钮中心 (541,2028)，离取消有 200 多像素。
        assertEquals(true, SoulVoiceRecordPolicy.isTapSafe(541, 2028, cancelBounds))
        // 按钮左边缘附近也还是安全的（取消右边缘 332 + 边距 24 = 356）。
        assertEquals(true, SoulVoiceRecordPolicy.isTapSafe(406, 2028, cancelBounds))
        assertEquals(true, SoulVoiceRecordPolicy.isTapSafe(360, 2028, cancelBounds))
    }

    @Test
    fun `a tap that drifts onto cancel is refused`() {
        // 真机实测：取消右边缘 x=332，暂停圆环左边缘 x=406 —— 中间只有 74 像素。
        // 点偏一点就会点到取消，把已经录好的丢掉。宁可这次不发，也不能替人按取消。
        assertEquals(false, SoulVoiceRecordPolicy.isTapSafe(332, 2028, cancelBounds))
        assertEquals(false, SoulVoiceRecordPolicy.isTapSafe(340, 2028, cancelBounds))
        assertEquals(false, SoulVoiceRecordPolicy.isTapSafe(240, 2045, cancelBounds))
        assertEquals(false, SoulVoiceRecordPolicy.isTapSafe(218, 2045, cancelBounds))
    }

    @Test
    fun `without a known cancel button nothing is blocked`() {
        assertEquals(true, SoulVoiceRecordPolicy.isTapSafe(200, 2000, null))
        // 宽高为 0 的无效矩形不能拿来当"禁区"。
        assertEquals(
            true,
            SoulVoiceRecordPolicy.isTapSafe(200, 2000, SoulVoiceRecordPolicy.Bounds(0, 0, 0, 0))
        )
    }

    @Test
    fun `bounds expose a usable centre`() {
        val bounds = SoulVoiceRecordPolicy.Bounds(406, 1893, 676, 2163)
        assertEquals(541, bounds.centerX)
        assertEquals(2028, bounds.centerY)
        assertEquals(true, bounds.isUsable)
        assertEquals(false, SoulVoiceRecordPolicy.Bounds(0, 0, 0, 0).isUsable)
    }

    // ---- 找不到录音入口时，该不该点模式开关（2026-10-06 20:00 事故）----

    /**
     * 只有确实在打字态才该点开关。
     *
     * 事故现场：录音面板没收干净 → 录音入口也看不见 → 代码又去点开关，
     * 但那时本来就是语音态，一点反而切成打字态，状态越弄越乱，
     * 后面所有文字回复 TIMEOUT、每 5 秒重试一次死循环。
     */
    @Test
    fun `the mode toggle is only tapped from the typing state`() {
        assertEquals(true, SoulVoiceRecordPolicy.shouldTapModeToggle(textInputVisible = true))
        assertEquals(false, SoulVoiceRecordPolicy.shouldTapModeToggle(textInputVisible = false))
    }

    @Test
    fun `the switch timeout stays short enough to not stall a reply`() {
        // 切模式是在自动回复的链路里等的，卡太久整条回复就超时了。
        assertEquals(true, SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_TIMEOUT_MS in 500..5_000)
    }
}
