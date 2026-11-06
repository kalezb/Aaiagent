package com.aaiagent.engine.automation

import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

/**
 * 本地自反思自愈记忆库 (Local Reflexion Memory)。
 *
 * 借鉴 Reflexion 顶会架构：
 * 1. 当智能体在手机端遇到未知浮层、悬浮表情栏、弹窗时，先查本地自愈记忆库（0ms 命中）；
 * 2. 若未命中，则调起云端视觉中枢 (/api/vision/ground) 拍照定位目标坐标；
 * 3. 定位成功后立即存入本地自愈记忆库，下次遇到同类 UI 现象即刻秒解，绝不再调云端、不再手写正则打补丁！
 */
object LocalReflexionMemory {

    data class MemoryPoint(
        val kind: String,
        val normalizedX: Double,
        val normalizedY: Double,
        val confidence: Double = 1.0,
        val hitCount: Int = 1,
        val lastSeenMs: Long = System.currentTimeMillis()
    )

    private val cache = ConcurrentHashMap<String, MemoryPoint>()

    init {
        // 基于 Redmi K70 Ultra (1220x2712) 实机实测基准预置自愈经验
        // 1. 悬浮表情推荐栏 (X) 关闭按钮: (171, 2346) -> normalized (0.140, 0.865)
        cache["meme_bar"] = MemoryPoint(
            kind = "meme_bar",
            normalizedX = 0.140,
            normalizedY = 0.865,
            confidence = 0.99
        )
        // 2. 聊天页左上角返回按钮: (90, 230) -> normalized (0.074, 0.085)
        cache["chat_back"] = MemoryPoint(
            kind = "chat_back",
            normalizedX = 0.074,
            normalizedY = 0.085,
            confidence = 0.99
        )
    }

    /**
     * 记录或更新一条自愈反思经验。
     */
    fun recordReflexion(
        kind: String,
        screenX: Int,
        screenY: Int,
        screenWidth: Int,
        screenHeight: Int,
        confidence: Double = 0.95
    ) {
        if (screenWidth <= 0 || screenHeight <= 0) return
        val normX = (screenX.toDouble() / screenWidth).coerceIn(0.0, 1.0)
        val normY = (screenY.toDouble() / screenHeight).coerceIn(0.0, 1.0)
        val existing = cache[kind]
        cache[kind] = MemoryPoint(
            kind = kind,
            normalizedX = normX,
            normalizedY = normY,
            confidence = confidence,
            hitCount = (existing?.hitCount ?: 0) + 1,
            lastSeenMs = System.currentTimeMillis()
        )
    }

    /**
     * 查询本地自愈反思记忆。
     * @return 返回适配当前屏幕分辨率的物理坐标 (x, y)，未命中返回 null。
     */
    fun getReflexionPoint(kind: String, screenWidth: Int, screenHeight: Int): Pair<Int, Int>? {
        val entry = cache[kind] ?: return null
        val px = (entry.normalizedX * screenWidth).roundToInt()
        val py = (entry.normalizedY * screenHeight).roundToInt()
        return Pair(px, py)
    }

    fun hasReflexion(kind: String): Boolean = cache.containsKey(kind)

    fun allMemories(): Map<String, MemoryPoint> = HashMap(cache)

    fun clear() {
        cache.clear()
    }
}
