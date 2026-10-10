package com.aaiagent.adapter

/**
 * Soul 语音录音面板的状态判断与动作决策。
 *
 * 真机实测（2026-10-06，OnePlus 8 / Android 11 / 当前 Soul 版本）：
 * - 输入栏右侧的 `audio_record_view_optimize`（文字「录音」）点一下就开始录音。
 *   它**只在语音输入态存在**，打字态下要先点 `menu_tab_voice_inner_outside` 切过去。
 * - **「暂停」和「发送」是同一个按钮**（屏幕正中偏下、直径约 270px 的圆）。
 *   只是 Soul 在状态切换时把整个节点换掉了：
 *   录音中是 `imv_bg_full_progress`（中心 (541,2028)），
 *   暂停后是 `imvStatusPlace`（中心 (540,1998)）—— 位置几乎一样。
 *   知道这一点很有用：发送时万一找不到新节点，可以直接复用点暂停时的坐标。
 * - 录音面板上**读不到已录秒数**：那个数字是直接画在圆环图片里的，界面树里没有节点。
 *   界面树里能搜到的 `tvVoiceLength` 属于**聊天记录里的语音气泡**，和这次录音毫无关系
 *   （实测：气泡在就读到它的时长、凑巧过关；气泡不在就读到空值、整条降级成文字）。
 *   所以核对改用**我们自己测的录制时长**，见 [verifyRecording]。
 * - 单条录音上限 60 秒，录到 60 秒会**自动暂停**，而且**不会自动发送** ——
 *   所以哪怕配音超长被掐断，最坏结果也只是停在面板上等人处理，不会误发。
 * - 面板自带「取消」（`btn_delete`），任何异常都能靠它体面退出。
 *   注意它离中间大按钮**只有 74 像素**（取消右边缘 x=332，圆环左边缘 x=406），
 *   点偏一点就会误点取消、把已经录好的丢掉 —— 见 [isTapSafe]。
 *
 * 这一层只做纯计算，真机上点哪里由 [SoulAdapter] 负责，方便脱离安卓做单元测试。
 */
object SoulVoiceRecordPolicy {

    /** Soul 单条录音的硬上限（真机实测：录到 60 秒自动暂停）。 */
    const val MAX_RECORD_MS = 60_000L

    const val MIN_RECORD_MS = 1_000L

    /** 录音启动余量：Soul 建立录音通道要一点时间，注入模块也要在此之前把配音加载好。 */
    const val START_MARGIN_MS = 400L

    /** 收尾余量：配音播完到按下暂停之间留一点，避免尾巴被切掉。 */
    const val FINALIZE_MARGIN_MS = 350L

    /**
     * 核对录制时长时允许的偏差。
     *
     * 我们用墙钟时间测录制时长：从"面板确认进入录音"到"面板确认暂停"。
     * 里面包含点按延迟和面板渲染时间，所以实测总会比预期略长一点点。
     * 反过来短太多就有问题（暂停提前生效了），要判失败。
     */
    const val RECORDING_TOLERANCE_MS = 1_500L

    /** 比预期长出这么多就认为不对（多半是暂停没生效，多录了一截）。 */
    const val RECORDING_EXCESS_MS = 5_000L

    /** 点按安全边距：离「取消」这么近就不点了，宁可放弃这一条。 */
    const val TAP_SAFETY_MARGIN_PX = 24

    /** 点完「录音」后，等面板出现「暂停录音」的上限。 */
    const val PANEL_APPEAR_TIMEOUT_MS = 3_000L

    /** 点完暂停后，等按钮变成「发语音」的上限。给宽一点：宁可多等，也别误判成失败。 */
    const val PANEL_SETTLE_TIMEOUT_MS = 5_000L

    /** 发送或取消后，等面板收起来的上限。 */
    const val PANEL_CLOSE_TIMEOUT_MS = 5_000L

    /** 等待时切成小片，方便中途响应"用户把手机抢过去了"。 */
    const val WAIT_SLICE_MS = 250L

    /**
     * 找不到「录音」入口时，最多点几次输入栏的"语音/文字"切换。
     *
     * 真机实测（2026-10-06）：`audio_record_view_optimize`（文字「录音」）只在**语音输入态**存在，
     * 打字态下输入栏是 `et_sendmessage` + `btn_send`。所以发语音前必须先切过去，
     * 否则每次都要人先手动点一下，AiaAgent 就不算"自己完成"。
     */
    const val VOICE_MODE_SWITCH_ATTEMPTS = 2

    /** 点完切换后，等「录音」入口出现的上限。 */
    const val VOICE_MODE_SWITCH_TIMEOUT_MS = 3_000L

    /**
     * 找不到录音入口时，该不该去点那个"语音/文字"模式开关？
     *
     * **只有确实在打字态才该点。** 真机事故（2026-10-06 19:57）：录音面板没收干净时
     * 录音入口也看不见，代码又去点开关 —— 但那时本来就是语音态，一点反而切成了打字态，
     * 状态越弄越乱，后面整条链全废、文字回复全部 TIMEOUT。
     *
     * @param textInputVisible 打字输入框在不在（在 = 现在是打字态）
     */
    fun shouldTapModeToggle(textInputVisible: Boolean): Boolean = textInputVisible

    const val LABEL_PAUSE = "暂停录音"
    const val LABEL_SEND = "发语音"

    /**
     * 面板中间那个大按钮的 viewId。
     *
     * **它是同一个按钮**，只是 Soul 在状态切换时把整个节点换掉了（位置几乎不变）：
     * - 录音中：`imv_bg_full_progress`（进度环本体），里面套一个 `imvStatus` 状态图标；
     *   此时 `imvStatusPlace` **压根不存在**。
     * - 暂停后：`imvStatusPlace`，而进度环那两个又没了。
     *
     * 之前只认 `imvStatusPlace`，所以录音中永远找不到按钮（pause_tap_failed）。
     * 现在两个都认 —— 而且因为是同一个按钮，发送时找不到 `imvStatusPlace`
     * 还可以直接复用点暂停时的坐标（见 [SoulAdapter] 的实现）。
     */
    private const val RECORDING_ACTION_ID = "imv_bg_full_progress"
    private const val RECORDING_ACTION_FALLBACK_ID = "imvStatus"
    private const val PAUSED_ACTION_ID = "imvStatusPlace"

    /** 给定面板状态，中间大按钮可能是哪些节点（按优先级）。 */
    fun actionButtonIds(state: PanelState): List<String> = when (state) {
        PanelState.RECORDING -> listOf(RECORDING_ACTION_ID, RECORDING_ACTION_FALLBACK_ID)
        PanelState.PAUSED -> listOf(PAUSED_ACTION_ID)
        PanelState.ABSENT -> emptyList()
    }

    enum class PanelState {
        /** 屏幕上没有录音面板。 */
        ABSENT,

        /** 正在录音：按钮显示「暂停录音」。 */
        RECORDING,

        /** 已经暂停：按钮显示「发语音」，并且能看到已录时长。 */
        PAUSED
    }

    enum class LengthVerdict {
        /** 录进去的时长和配音对得上，可以发。 */
        OK,

        /** 撞上 60 秒上限被掐断，这条配音一条消息放不下 —— 绝不能发。 */
        TRUNCATED,

        /** 和配音时长对不上（读到的数字偏差过大），不能发。 */
        MISMATCH,

        /** 读不到时长，不敢发。 */
        UNREADABLE
    }

    /**
     * 判断录音面板现在处于什么状态。
     *
     * [middleButtonLabel] 是中间大按钮的文字：录音中是 [LABEL_PAUSE]，暂停后是 [LABEL_SEND]。
     *
     * **不再拿"有没有显示已录时长"做兜底**：真机实测那个节点的 id（`tvVoiceLength`）
     * 和聊天记录里语音气泡的时长**重名** —— 只要聊天里有一条带时长的语音气泡，
     * 这里就会把"根本不在录音"误判成"已经暂停"。读不到按钮文字就老老实实当没有面板，
     * 调用方会按失败处理 —— 那是安全的，误判成"已暂停"才会真出事。
     */
    fun panelState(middleButtonLabel: String?): PanelState {
        return when (middleButtonLabel?.trim()) {
            LABEL_PAUSE -> PanelState.RECORDING
            LABEL_SEND -> PanelState.PAUSED
            else -> PanelState.ABSENT
        }
    }

    /**
     * 点完「录音」之后要跑多久才按暂停。
     *
     * 配音从录音一开始就注入，所以「配音时长 + 启动余量 + 收尾余量」就是该按住录音的时长，
     * 再卡在 Soul 的硬上限内。真机上因为点击式录音对时间不敏感，这点容错足够。
     */
    fun recordDurationMs(audioDurationMs: Long): Long {
        if (audioDurationMs <= 0L) return MIN_RECORD_MS
        return (audioDurationMs + START_MARGIN_MS + FINALIZE_MARGIN_MS)
            .coerceIn(MIN_RECORD_MS, MAX_RECORD_MS)
    }

    /**
     * 这条配音是不是一条录音塞不下（含余量后超过 60 秒）。
     * 判 true 时不要硬录，应该拆成多条，否则尾巴一定会被掐掉。
     */
    fun exceedsSingleRecordLimit(audioDurationMs: Long): Boolean =
        audioDurationMs + START_MARGIN_MS + FINALIZE_MARGIN_MS > MAX_RECORD_MS

    /**
     * 已经找过 [failedAttempts] 次「录音」入口都没找到之后，还要不要再点一次切换。
     * 用纯函数把循环上界钉住，免得以后越改越多次、把界面点乱。
     */
    fun shouldKeepSwitching(failedAttempts: Int): Boolean =
        failedAttempts in 0 until VOICE_MODE_SWITCH_ATTEMPTS

    /** 把面板上的 `41"` / `60"` / `41秒` 解析成秒数；读不出来返回 null。 */
    fun parseLengthSeconds(label: String?): Int? {
        val digits = label?.trim()?.takeWhile(Char::isDigit).orEmpty()
        return digits.toIntOrNull()?.takeIf { it > 0 }
    }

    /**
     * 发送之前的最后一道核对：**我们自己测出来的录制时长**和配音对得上吗。
     *
     * 为什么不用界面上的秒数：那个数字是画在圆环图片里的，界面树里没有节点；
     * 而界面树里能搜到的 `tvVoiceLength` 属于聊天记录里的语音气泡，
     * 拿它判断等于"看别人的体检报告决定自己吃不吃药"（实测时好时坏就是这么来的）。
     *
     * [measuredMs] 是墙钟时间：从"面板确认进入录音"到"面板确认暂停"。
     * 它天然包含点按延迟，所以通常会比 [expectedMs] 略长 —— 这是正常的，不算错。
     * 真正要拦的是两种：**短太多**（暂停提前生效，配音没录完）和**撞上 60 秒上限**
     * （被硬截断，后半句根本没进去）。
     */
    fun verifyRecording(expectedMs: Long, measuredMs: Long): LengthVerdict {
        if (expectedMs <= 0L || measuredMs <= 0L) return LengthVerdict.UNREADABLE
        if (measuredMs < MIN_RECORD_MS) return LengthVerdict.TRUNCATED
        // 录到（或超过）上限，说明被 60 秒硬截断了。
        if (measuredMs >= MAX_RECORD_MS) return LengthVerdict.TRUNCATED
        // 录得比该录的短太多 —— 配音尾巴大概率没进去。
        if (measuredMs + RECORDING_TOLERANCE_MS < expectedMs) return LengthVerdict.TRUNCATED
        // 长得离谱，多半是暂停没生效、多录了一截。
        if (measuredMs > expectedMs + RECORDING_EXCESS_MS) return LengthVerdict.MISMATCH
        return LengthVerdict.OK
    }

    /** 屏幕上的一个矩形区域，用来做点按安全判断。 */
    data class Bounds(
        val left: Int,
        val top: Int,
        val right: Int,
        val bottom: Int
    ) {
        val width: Int get() = right - left
        val height: Int get() = bottom - top
        val isUsable: Boolean get() = width > 0 && height > 0
        val centerX: Int get() = (left + right) / 2
        val centerY: Int get() = (top + bottom) / 2
        fun contains(x: Int, y: Int): Boolean =
            x in left..right && y in top..bottom
    }

    /**
     * 这个点按位置安不安全（会不会误点到「取消」）。
     *
     * 真机实测：取消按钮 `(146,1952)-(332,2138)`，中间大按钮 `(406,1893)-(676,2163)` ——
     * **两者水平方向只隔 74 像素**。点偏一点就会点到取消，把已经录好的丢掉。
     * 所以点之前先算一遍：只要落进"取消 + 安全边距"的范围内就放弃这一条，
     * 宁可这次不发语音，也不能替人按了取消。
     */
    fun isTapSafe(x: Int, y: Int, cancel: Bounds?): Boolean {
        if (cancel == null || !cancel.isUsable) return true
        val guarded = Bounds(
            left = cancel.left - TAP_SAFETY_MARGIN_PX,
            top = cancel.top - TAP_SAFETY_MARGIN_PX,
            right = cancel.right + TAP_SAFETY_MARGIN_PX,
            bottom = cancel.bottom + TAP_SAFETY_MARGIN_PX
        )
        return !guarded.contains(x, y)
    }
}
