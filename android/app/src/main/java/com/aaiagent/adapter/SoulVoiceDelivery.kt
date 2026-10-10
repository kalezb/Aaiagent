package com.aaiagent.adapter

import kotlinx.coroutines.delay

/**
 * 语音发送的流程编排。
 *
 * 顺序：点「录音」→ 等配音放完 → 点「暂停」→ 核对我们自己测的录制时长 → 点「发送」→ 等面板收起。
 *
 * 注意「暂停」和「发送」是**同一个按钮**，只是 Soul 在状态切换时把节点换掉了 ——
 * 所以实现方 [SoulVoiceScreen.tapPause] / [SoulVoiceScreen.tapSend] 点的是同一个位置。
 *
 * **铁律**：不管成功、失败、被取消，还是用户中途把手机抢回去，离开前都必须把录音面板收掉，
 * 绝不能把"还在录音"的状态留给下一轮。所有出口都会走 [cleanup]。
 *
 * 这里不碰任何安卓 API（只依赖协程），点哪里由 [SoulVoiceScreen] 提供，
 * 真机上由 [SoulAdapter] 实现，测试里换成假的就能把每条分支都跑一遍。
 */
class SoulVoiceDelivery(
    private val screen: SoulVoiceScreen,
    /** 录音期间的等待方式。测试里换成空实现就不用真的等。 */
    private val wait: suspend (Long) -> Unit = { delay(it) },
    /** 取当前时间。测试里注入假的就能把"录了多久"精确控制住。 */
    private val now: () -> Long = { System.currentTimeMillis() },
) {

    /** 真机上由 [SoulAdapter] 实现；测试里换成假的。 */
    interface SoulVoiceScreen {
        /**
         * 打开录音面板。
         *
         * 实现方负责两件事：先确保处在**语音输入态**（打字态下没有「录音」入口，
         * 见 [SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_ATTEMPTS]），再点它。
         */
        suspend fun openRecorder(): Boolean

        /** 读当前录音面板的状态。 */
        fun panelState(): SoulVoiceRecordPolicy.PanelState

        /**
         * 点中间那个大按钮 —— **「暂停」和「发送」是同一个按钮**，
         * 此刻它叫「暂停录音」，实现方按当前状态决定点哪里。
         */
        fun tapPause(): Boolean

        /** 点同一个按钮（此刻它叫「发语音」）。 */
        fun tapSend(): Boolean

        /** 点「取消」。 */
        fun tapCancel(): Boolean

        /** 等到面板变成指定状态；超时返回 false。 */
        suspend fun awaitPanelState(
            state: SoulVoiceRecordPolicy.PanelState,
            timeoutMs: Long
        ): Boolean

        /** 等到录音面板收起来（回到普通聊天页）；超时返回 false。 */
        suspend fun awaitPanelClosed(timeoutMs: Long): Boolean
    }

    enum class Status {
        /** 已经点出发送，气泡由调用方再去核对。 */
        SENT,

        /** 主动放弃（例如时长对不上），没有发出去。 */
        CANCELLED,

        /** 流程出错，没有发出去。 */
        FAILED,

        /** 用户把手机抢回去了，中止。 */
        STOPPED
    }

    data class Result(
        val status: Status,
        /**
         * 我们自己测出来的录制秒数（墙钟时间）。
         *
         * 注意**不是**面板上显示的数字 —— 那个读不到（画在图里）。
         * 这个值由代码计时得出，用来做核对和记日志。
         */
        val recordedSeconds: Int? = null,
        val reason: String = ""
    )

    suspend fun recordAndSend(
        audioDurationMs: Long,
        canProceed: () -> Boolean = { true },
        /**
         * 外放模式下用：**录音确认开始之后**把配音从扬声器放出来。
         *
         * 注入模式传 null（配音是通过 ContentProvider 直接灌进录音缓冲的，手机不出声）。
         * 传进来的这个动作必须**立即返回**（由调用方自己起协程去放）——
         * 在这里同步等它放完的话，录制时长会变成"配音 + 等待"两倍，后面的时长核对也会跟着错。
         */
        playback: (() -> Unit)? = null
    ): Result {
        if (audioDurationMs <= 0L) return fail("invalid_duration")
        if (SoulVoiceRecordPolicy.exceedsSingleRecordLimit(audioDurationMs)) {
            return fail("audio_too_long_for_one_message")
        }
        if (!canProceed()) return stopped("taken_over_before_start")

        if (!screen.openRecorder()) return fail("recorder_open_failed")
        if (!screen.awaitPanelState(
                SoulVoiceRecordPolicy.PanelState.RECORDING,
                SoulVoiceRecordPolicy.PANEL_APPEAR_TIMEOUT_MS
            )
        ) {
            return fail("recording_not_started")
        }

        // 录制时长的核对用**我们自己测的墙钟时间**。
        //
        // 不用界面上的秒数：那个数字画在圆环图片里，界面树里没有节点；
        // 而界面树里能搜到的 tvVoiceLength 属于聊天记录里的语音气泡，
        // 拿它判断等于看别人的体检报告决定自己吃不吃药（实测时好时坏就是这么来的）。
        //
        // **量到"暂停真正生效"为止，不能把"等界面确认已暂停"的时间也算进去。**
        //
        // 这里有两种延迟，必须分开：
        // - **点按延迟**（tapPause 返回前）：暂停还没生效，录音机还在录 → **要算**；
        // - **确认延迟**（awaitPanelState 期间）：录音已经停了，只是界面还没反应过来
        //   → **不能算**。
        // 真机事故（2026-10-06 20:16）：点暂停是准时的，但界面确认慢了约 5 秒，
        // 原来的代码量到"确认那一刻"，于是比目标多 5 秒、正好顶到容差之外，
        // 判成 recording_mismatch → 整条语音被取消、退回文字。
        val startedAtMs = now()

        // 外放：录音已经开始，现在把声音放出来。立即返回，不等它放完。
        runCatching { playback?.invoke() }
            .onFailure { android.util.Log.w("AIA", "外放启动失败: ${it.message}") }

        val targetMs = SoulVoiceRecordPolicy.recordDurationMs(audioDurationMs)
        if (!waitWhileRecording(targetMs, canProceed)) {
            return stopped("taken_over_while_recording")
        }
        if (!canProceed()) return stopped("taken_over_before_pause")

        if (!screen.tapPause()) return fail("pause_tap_failed")

        // 量时间点在这里 —— 点完暂停（录音已停），但还没等界面确认。
        val measuredMs = now() - startedAtMs

        if (!screen.awaitPanelState(
                SoulVoiceRecordPolicy.PanelState.PAUSED,
                SoulVoiceRecordPolicy.PANEL_SETTLE_TIMEOUT_MS
            )
        ) {
            return fail("pause_not_confirmed")
        }

        val measuredSeconds = (measuredMs / 1000L).toInt().coerceAtLeast(0)
        val verdict = SoulVoiceRecordPolicy.verifyRecording(targetMs, measuredMs)
        if (verdict != SoulVoiceRecordPolicy.LengthVerdict.OK) {
            screen.tapCancel()
            screen.awaitPanelClosed(SoulVoiceRecordPolicy.PANEL_CLOSE_TIMEOUT_MS)
            return Result(Status.CANCELLED, measuredSeconds, "recording_" + verdict.name.lowercase())
        }

        if (!canProceed()) return stopped("taken_over_before_send")

        if (!screen.tapSend()) return fail("send_tap_failed")
        if (!screen.awaitPanelClosed(SoulVoiceRecordPolicy.PANEL_CLOSE_TIMEOUT_MS)) {
            // 点过发送但面板没收起，不敢当作成功 —— 先点取消，避免留在录音状态。
            screen.tapCancel()
            screen.awaitPanelClosed(SoulVoiceRecordPolicy.PANEL_CLOSE_TIMEOUT_MS)
            return Result(Status.FAILED, measuredSeconds, "panel_not_closed_after_send")
        }
        return Result(Status.SENT, measuredSeconds, "sent")
    }

    /**
     * 录音期间分段等待，中途能响应"用户把手机抢过去了"。
     * 被打断时一定要把录音面板收掉，否则会一直录下去。
     */
    private suspend fun waitWhileRecording(
        totalMs: Long,
        canProceed: () -> Boolean
    ): Boolean {
        var waited = 0L
        while (waited < totalMs) {
            if (!canProceed()) {
                cleanup()
                return false
            }
            val slice = minOf(SoulVoiceRecordPolicy.WAIT_SLICE_MS, totalMs - waited)
            wait(slice)
            waited += slice
        }
        return true
    }

    private suspend fun fail(reason: String): Result {
        cleanup()
        return Result(Status.FAILED, null, reason)
    }

    private suspend fun stopped(reason: String): Result {
        cleanup()
        return Result(Status.STOPPED, null, reason)
    }

    /** 离开前把录音面板收干净 —— 这是本类唯一的收尾出口。 */
    private suspend fun cleanup() {
        if (screen.panelState() == SoulVoiceRecordPolicy.PanelState.ABSENT) return
        screen.tapCancel()
        screen.awaitPanelClosed(SoulVoiceRecordPolicy.PANEL_CLOSE_TIMEOUT_MS)
    }
}
