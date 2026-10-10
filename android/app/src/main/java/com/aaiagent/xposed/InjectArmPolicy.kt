package com.aaiagent.xposed

/**
 * "配音到了，什么时候挂到录音上"这条规则。
 *
 * 单独放一个文件、**不依赖任何安卓 API**，是为了能脱离真机做单元测试 ——
 * 这条规则出错的表现是"语音发出去了但没声音"，在真机上非常难查。
 */
object InjectArmPolicy {

    /**
     * 配音刚被取到、而录音**已经开始了** —— 要不要立刻补挂上去？
     *
     * **要。** 这是 2026-10-06 18:16 那次"语音没声音"的根因：
     * 应用发布配音（43.490）到模块轮询线程取到（43.853）之间差了约 250ms，
     * 而 Soul 的 `startRecording` 正好落在这条缝里。当时的代码在 `onStart` 里发现
     * `pcm == null` 就直接放弃，整段录音于是全是静音 —— 而且没有日志，很难查。
     *
     * 已经挂过（[alreadyArmed]）就不重复挂，免得把游标重置、同一段配音播两遍。
     */
    fun shouldArmOnLoad(sessionActive: Boolean, alreadyArmed: Boolean): Boolean =
        sessionActive && !alreadyArmed

    /**
     * 录音刚开始时，配音还没到 —— 该放弃还是等？
     *
     * **等。** 见 [shouldArmOnLoad] 的说明。
     */
    fun shouldWaitForPcm(sessionActive: Boolean, hasPcm: Boolean): Boolean =
        sessionActive && !hasPcm
}
