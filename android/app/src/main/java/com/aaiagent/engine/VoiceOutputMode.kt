package com.aaiagent.engine

/** 配音怎么送进 Soul 的录音。 */
enum class VoiceOutput {
    /** 注入：LSPosed 模块直接替换录音数据。音质干净，但**必须 root**。 */
    INJECT,

    /** 外放：用扬声器放出来、让麦克风录进去。**不需要 root**，但会带上房间回声。 */
    SPEAKER,
}

/**
 * 这台手机该用哪种方式送配音。
 *
 * 背景（用户 2026-10-06 定的）：不是所有手机都会 root。
 * root 过的走注入（音质干净），没 root 的走外放（能用就行）。
 *
 * 自动判断的依据是"注入模块还活着吗" —— 模块每 400ms 来问一次配音，
 * 只要最近几秒内有人问过，就说明它在跑（见 InjectPcmStore.isModuleAlive）。
 * 没 root 的手机上根本没有这个模块，自然就落到外放。
 *
 * 另外留了手动覆盖：在已经 root 的机器上强行测外放时用得到。
 */
object VoiceOutputMode {
    const val CONFIG_KEY = "voice_output_mode"
    const val AUTO = "auto"
    const val INJECT = "inject"
    const val SPEAKER = "speaker"

    /**
     * 用户定的**尾部静音目标**：配音放完之后，录音再多留 1 秒。
     *
     * 留这一段是为了不切掉声音的尾巴（以及"点暂停"这个动作本身的延迟）。
     * 实际值会比它略大 —— 因为点暂停、等面板确认都要时间，那部分控制不了。
     * （用户先定 1.5 秒，随后改成 1 秒。）
     */
    const val SPEAKER_TAIL_SILENCE_TARGET_MS = 1_000L

    /**
     * 外放时额外加进"该录多久"的余量。
     *
     * 注入是数据直接灌进录音缓冲，从第一个采样点就准；外放要等扬声器真的响起来、
     * 声音传到麦克风，前面那几百毫秒是空的。不留这段，对方听到的开头就会缺字。
     *
     * 这个值不是拍脑袋来的：`recordDurationMs` 自己还会加 400 + 350 的收尾余量，
     * 所以 **250 + 400 + 350 = 1000**，正好等于上面那个尾部静音目标。
     * 测试里把这条等式钉死了，改一个数另一个不改就会红。
     */
    const val SPEAKER_EXTRA_MS = 250L

    /**
     * 外放模式下应当录多久。
     *
     * 加上 `SoulVoiceRecordPolicy.recordDurationMs` 自带的收尾余量之后，
     * 尾部静音正好是 [SPEAKER_TAIL_SILENCE_TARGET_MS]（1.5 秒）。
     */
    fun speakerRecordDurationMs(audioDurationMs: Long): Long =
        if (audioDurationMs <= 0L) 0L else audioDurationMs + SPEAKER_EXTRA_MS

    /**
     * 最终用哪种方式。
     *
     * @param configured 配置里的值（auto / inject / speaker），空或认不出来按 auto 处理
     * @param moduleAlive 注入模块现在是否在运行
     */
    fun resolve(configured: String?, moduleAlive: Boolean): VoiceOutput {
        return when (configured?.trim()?.lowercase()) {
            INJECT -> VoiceOutput.INJECT
            SPEAKER -> VoiceOutput.SPEAKER
            // auto 或者写错的值：以"模块活不活"为准。
            else -> if (moduleAlive) VoiceOutput.INJECT else VoiceOutput.SPEAKER
        }
    }
}
