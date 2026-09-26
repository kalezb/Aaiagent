package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Soul 互动表情本地识别：截图 + 感知哈希(dHash)比对，不调视觉大模型。
 *
 * 参考图打包在 assets/sticker_ref/ 下，文件名 = type 字段，如 poke_it.png。
 * 14 种互动表情（含额外的"在干嘛"占位）。
 */
object StickerMatcher {

    data class Sticker(val type: String, val displayName: String)

    /** type 字段 -> 中文显示名，顺序与 APK 资源数组一致 */
    private val STICKERS = listOf(
        Sticker("poke_it",       "戳一下"),
        Sticker("clapping_head", "拍一下"),
        Sticker("water_gun",     "皮一下"),
        Sticker("cat_paw",       "挠一下"),
        Sticker("pat_it",        "摸一下"),
        Sticker("zaiganma",      "在干嘛"),
        Sticker("yyds",          "YYDS"),
        Sticker("jyy",           "加油鸭"),
        Sticker("nice",          "奈斯奈斯"),
        Sticker("ylbz",          "用力抱住"),
        Sticker("jsdd",          "举手dd"),
        Sticker("wndcall",       "为你打Call"),
        Sticker("hahaha",        "哈哈哈"),
        Sticker("lvlvlv",        "略略略"),
    )

    private var referenceHashes: Map<String, Long>? = null

    /** 启动时调用一次，加载 assets 参考图并计算 dHash */
    fun warmup(service: AccessibilityService) {
        if (referenceHashes != null) return
        val map = mutableMapOf<String, Long>()
        try {
            for (s in STICKERS) {
                val path = "sticker_ref/${s.type}.png"
                val exists = service.assets.list("sticker_ref")?.contains("${s.type}.png") == true
                if (!exists) continue
                service.assets.open(path).use { fd ->
                    val bmp = BitmapFactory.decodeStream(fd) ?: return@use
                    map[s.type] = dHash(bmp)
                    bmp.recycle()
                }
            }
        } catch (e: Exception) {
            Log.w("AIA", "Sticker warmup failed", e)
        }
        referenceHashes = map
        Log.d("AIA", "StickerMatcher warmed up: ${map.size} references")
    }

    /** 截指定区域，返回最匹配的表情名；失败返回 null */
    suspend fun match(service: AccessibilityService, bounds: Rect): String? {
        warmup(service)
        val refs = referenceHashes ?: return null
        if (refs.isEmpty()) return null

        val screenBmp = takeScreenshotBitmap(service, bounds) ?: return null
        return try {
            val hash = dHash(screenBmp)
            var bestType: String? = null
            var bestDist = Int.MAX_VALUE
            for ((type, refHash) in refs) {
                val dist = hammingDistance(hash, refHash)
                if (dist < bestDist) {
                    bestDist = dist
                    bestType = type
                }
            }
            // 阈值：dHash 64位，汉明距离 < 12 认为匹配
            if (bestDist <= 12) {
                val name = STICKERS.find { it.type == bestType }?.displayName ?: bestType
                Log.d("AIA", "Sticker match: $bestType ($name) distance=$bestDist")
                name
            } else {
                Log.d("AIA", "Sticker no match, best=$bestType dist=$bestDist")
                null
            }
        } finally {
            screenBmp.recycle()
        }
    }

    /** 截全屏，crop 到目标区域，返回 Bitmap */
    private suspend fun takeScreenshotBitmap(service: AccessibilityService, bounds: Rect): Bitmap? {
        val result = suspendCancellableCoroutine<AccessibilityService.ScreenshotResult?> { cont ->
            try {
                service.takeScreenshot(
                    android.view.Display.DEFAULT_DISPLAY,
                    service.mainExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(r: AccessibilityService.ScreenshotResult) {
                            if (cont.isActive) cont.resumeWith(Result.success(r))
                        }
                        override fun onFailure(errorCode: Int) {
                            Log.w("AIA", "Sticker screenshot failed code=$errorCode")
                            if (cont.isActive) cont.resumeWith(Result.success(null))
                        }
                    }
                )
            } catch (e: Exception) {
                if (cont.isActive) cont.resumeWith(Result.success(null))
            }
        } ?: return null

        return try {
            val hwBuf = result.hardwareBuffer
            val wrapped = Bitmap.wrapHardwareBuffer(hwBuf, result.colorSpace)
            hwBuf.close()
            val software = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
            if (wrapped != null && wrapped !== software) wrapped.recycle()
            val src = software ?: return null
            // crop，留一点 padding
            val pad = 10
            val left = (bounds.left - pad).coerceIn(0, src.width - 1)
            val top = (bounds.top - pad).coerceIn(0, src.height - 1)
            val right = (bounds.right + pad).coerceIn(left + 1, src.width)
            val bottom = (bounds.bottom + pad).coerceIn(top + 1, src.height)
            val cropped = Bitmap.createBitmap(src, left, top, right - left, bottom - top)
            if (cropped !== src) src.recycle()
            cropped
        } catch (e: Exception) {
            Log.w("AIA", "Sticker bitmap process failed", e)
            null
        }
    }

    /** 差值哈希(dHash)：缩放到 9x8 灰度，相邻像素比较，输出 64bit long */
    private fun dHash(bmp: Bitmap): Long {
        val w = 9
        val h = 8
        val scaled = Bitmap.createScaledBitmap(bmp, w, h, true)
        try {
            var hash = 0L
            var bit = 0
            for (y in 0 until h) {
                for (x in 0 until w - 1) {
                    val c1 = scaled.getPixel(x, y)
                    val c2 = scaled.getPixel(x + 1, y)
                    val g1 = (0.299 * android.graphics.Color.red(c1) +
                        0.587 * android.graphics.Color.green(c1) +
                        0.114 * android.graphics.Color.blue(c1)).toInt()
                    val g2 = (0.299 * android.graphics.Color.red(c2) +
                        0.587 * android.graphics.Color.green(c2) +
                        0.114 * android.graphics.Color.blue(c2)).toInt()
                    if (g1 > g2) hash = hash or (1L shl bit)
                    bit++
                }
            }
            return hash
        } finally {
            if (scaled !== bmp) scaled.recycle()
        }
    }

    private fun hammingDistance(a: Long, b: Long): Int {
        return java.lang.Long.bitCount(a xor b)
    }
}
