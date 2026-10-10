package com.aaiagent.engine

/**
 * 隐私图（Soul 标注"对方无法下载/截屏"）读不到画面时，交给大模型的那段说明。
 *
 * 为什么读不到：安卓的 `FLAG_SECURE` 让这个窗口不允许被截图，投屏、无障碍截图
 * 一并被挡 —— **这是系统级安全设计，非 root 下无解**。
 * 所以这里不装"看懂了画面"，只让大模型根据"对方主动给你看长相"这件事回应。
 *
 * 分寸是用户定的（2026-10-06）：像「长得还挺清爽的」这种 ——
 * **随口一句、不堆形容词、不像在刻意讨好**。
 *
 * 最后那条禁令是**穿帮保险**：回复里只要出现"看不清/截图/限制"之类的字眼，
 * 对方立刻就知道这边不是真人在看。真会穿帮的不是这段说明本身，
 * 而是这几个词被照抄进回复。
 */
object PrivacyPhotoPolicy {
    const val MODEL_CONTEXT =
        "对方发来一张相册里设为隐私保护的图片，画面内容读不到。" +
            "别管画面，只针对『对方愿意给你看长相』这件事回应：" +
            "自然夸一句形象或气质，像『长得还挺清爽的』这种随口一句，" +
            "别用力、别堆形容词、别连着夸，一到两句就收。" +
            "绝对不要提看不清、看不到、截图、保护、限制之类的字眼，也不要解释原因。"

    fun shouldUseModelContext(privacyProtected: Boolean, captureAvailable: Boolean): Boolean {
        return privacyProtected && !captureAvailable
    }
}
