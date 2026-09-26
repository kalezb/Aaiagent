package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Soul 互动表情本地识别：截图 + 白底裁边后的像素模板比对，不调视觉大模型。
 *
 * 参考图打包在 assets/sticker_ref/ 下，文件名 = type 字段，如 poke_it.png。
 * 14 种互动表情。
 */
object StickerMatcher {

    data class Sticker(val type: String, val displayName: String, val meaning: String)

    private data class ReferenceTemplate(val normal: IntArray, val mirrored: IntArray)

    /** type 字段 -> 中文显示名，顺序与 APK 资源数组一致 */
    private val STICKERS = listOf(
        Sticker("poke_it",       "戳一下",     "对方戳了你一下，通常是在打招呼、逗你或提醒你回消息"),
        Sticker("clapping_head", "拍一下",     "对方拍了拍你，通常是打招呼、催你回消息或表达亲昵互动"),
        Sticker("water_gun",     "皮一下",     "对方和你开玩笑，气氛轻松调皮"),
        Sticker("cat_paw",       "挠一下",     "对方挠你一下，通常是调侃、逗趣或轻柔催促"),
        Sticker("pat_it",        "摸一下",     "对方摸摸你，通常表达安慰、关心或亲昵互动"),
        Sticker("zaiganma",      "在干嘛",     "对方问你在干嘛，想开启聊天或确认你有没有空"),
        Sticker("yyds",          "YYDS",       "对方夸你永远的神，表示强烈认可、夸赞或佩服"),
        Sticker("jyy",           "加油鸭",     "对方给你加油鼓励，表达支持"),
        Sticker("nice",          "奈斯奈斯",   "对方表示很好、很棒、赞同或满意"),
        Sticker("ylbz",          "用力抱住",   "对方想给你一个用力的拥抱，表达安慰、亲近或想念"),
        Sticker("jsdd",          "举手dd",     "对方举手报到，表示自己在线、愿意参与或主动打招呼"),
        Sticker("wndcall",       "为你打Call", "对方给你应援打Call，表示支持、鼓励或赞赏"),
        Sticker("hahaha",        "哈哈哈",     "对方被逗笑或表示开心，气氛轻松"),
        Sticker("lvlvlv",        "略略略",     "对方在调皮吐槽、撒娇式挑衅或开玩笑"),
    )

    private var referenceTemplates: Map<String, ReferenceTemplate>? = null

    /** 识别结果给大模型时使用的自然语言描述。 */
    fun modelTextFor(displayName: String): String? {
        val sticker = STICKERS.firstOrNull {
            it.displayName.equals(displayName.trim(), ignoreCase = true)
        } ?: return null
        return "对方发来 Soul 互动表情「${sticker.displayName}」：${sticker.meaning}"
    }

    /** 启动时调用一次，加载 assets 参考图并生成归一化模板。 */
    fun warmup(service: AccessibilityService) {
        if (referenceTemplates != null) return
        val map = mutableMapOf<String, ReferenceTemplate>()
        try {
            for (s in STICKERS) {
                val path = "sticker_ref/${s.type}.png"
                val exists = service.assets.list("sticker_ref")?.contains("${s.type}.png") == true
                if (!exists) continue
                service.assets.open(path).use { fd ->
                    val bmp = BitmapFactory.decodeStream(fd) ?: return@use
                    map[s.type] = ReferenceTemplate(
                        normal = normalizedPixels(bmp, mirror = false),
                        mirrored = normalizedPixels(bmp, mirror = true)
                    )
                    bmp.recycle()
                }
            }
        } catch (e: Exception) {
            Log.w("AIA", "Sticker warmup failed", e)
        }
        referenceTemplates = map
        Log.d("AIA", "StickerMatcher warmed up: ${map.size} references")
    }

    /** 截指定区域，返回最匹配的表情名；失败返回 null */
    suspend fun match(service: AccessibilityService, bounds: Rect): String? {
        warmup(service)
        val refs = referenceTemplates ?: return null
        if (refs.isEmpty()) return null

        val screenBmp = takeScreenshotBitmap(service, bounds) ?: return null
        return try {
            val target = normalizedPixels(screenBmp, mirror = false)
            var bestType: String? = null
            var bestDist = Double.MAX_VALUE
            for ((type, template) in refs) {
                val dist = minOf(
                    differenceScore(target, template.normal),
                    differenceScore(target, template.mirrored)
                )
                if (dist < bestDist) {
                    bestDist = dist
                    bestType = type
                }
            }
            if (bestDist <= MAX_TEMPLATE_DISTANCE) {
                val name = STICKERS.find { it.type == bestType }?.displayName ?: bestType
                Log.d("AIA", "Sticker match: $bestType ($name) distance=%.2f".format(bestDist))
                name
            } else {
                Log.d("AIA", "Sticker no match, best=$bestType dist=%.2f".format(bestDist))
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

    /** 去掉透明背景和空白边，缩放到统一模板；左右镜像用于兼容收发方向。 */
    private fun normalizedPixels(bmp: Bitmap, mirror: Boolean): IntArray {
        val normalized = normalizeForTemplate(bmp)
        val scaled = Bitmap.createScaledBitmap(normalized, TEMPLATE_SIZE, TEMPLATE_SIZE, true)
        try {
            val pixels = IntArray(TEMPLATE_SIZE * TEMPLATE_SIZE)
            scaled.getPixels(pixels, 0, TEMPLATE_SIZE, 0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)
            if (!mirror) return pixels

            val mirrored = IntArray(pixels.size)
            for (y in 0 until TEMPLATE_SIZE) {
                val row = y * TEMPLATE_SIZE
                for (x in 0 until TEMPLATE_SIZE) {
                    mirrored[row + x] = pixels[row + TEMPLATE_SIZE - 1 - x]
                }
            }
            return mirrored
        } finally {
            if (scaled !== normalized) scaled.recycle()
            normalized.recycle()
        }
    }

    /** 返回归一化 RGB 的平均通道差，越小越像。 */
    private fun differenceScore(first: IntArray, second: IntArray): Double {
        if (first.size != second.size) return Double.MAX_VALUE
        var total = 0L
        for (index in first.indices) {
            val a = first[index]
            val b = second[index]
            total += kotlin.math.abs(android.graphics.Color.red(a) - android.graphics.Color.red(b))
            total += kotlin.math.abs(android.graphics.Color.green(a) - android.graphics.Color.green(b))
            total += kotlin.math.abs(android.graphics.Color.blue(a) - android.graphics.Color.blue(b))
        }
        return total.toDouble() / (first.size * 3)
    }

    /**
     * Android 解码透明 PNG 后，透明像素的 RGB 可能是黑色；聊天截图背景则是白色。
     * 先合成到白底并裁掉空白边，避免同一表情因背景差异导致模板失真。
     */
    private fun normalizeForTemplate(source: Bitmap): Bitmap {
        val width = source.width
        val height = source.height
        val original = IntArray(width * height)
        val flattened = IntArray(width * height)
        source.getPixels(original, 0, width, 0, 0, width, height)

        var left = width
        var top = height
        var right = -1
        var bottom = -1
        for (y in 0 until height) {
            val row = y * width
            for (x in 0 until width) {
                val color = original[row + x]
                val alpha = android.graphics.Color.alpha(color)
                val red = (android.graphics.Color.red(color) * alpha + 255 * (255 - alpha) + 127) / 255
                val green = (android.graphics.Color.green(color) * alpha + 255 * (255 - alpha) + 127) / 255
                val blue = (android.graphics.Color.blue(color) * alpha + 255 * (255 - alpha) + 127) / 255
                flattened[row + x] = android.graphics.Color.rgb(red, green, blue)
                if (minOf(red, green, blue) < 245) {
                    if (x < left) left = x
                    if (x > right) right = x
                    if (y < top) top = y
                    if (y > bottom) bottom = y
                }
            }
        }

        val full = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        full.setPixels(flattened, 0, width, 0, 0, width, height)
        if (right < left || bottom < top) return full

        val cropped = Bitmap.createBitmap(full, left, top, right - left + 1, bottom - top + 1)
        if (cropped !== full) full.recycle()
        return cropped
    }

    private const val TEMPLATE_SIZE = 48
    private const val MAX_TEMPLATE_DISTANCE = 18.0
}
