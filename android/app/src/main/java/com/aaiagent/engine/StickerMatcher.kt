package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.math.roundToInt

/**
 * Soul 互动表情本地识别：截图 + 白底裁边后的像素模板比对，不调视觉大模型。
 *
 * 参考图打包在 assets/sticker_ref/ 下，文件名 = type 字段，如 poke_it.png。
 * 14 种互动表情。
 */
object StickerMatcher {

    data class Sticker(val type: String, val displayName: String, val meaning: String)

    private data class ReferenceTemplate(val normal: IntArray, val mirrored: IntArray)

    private val STICKERS = listOf(
        Sticker("poke_it", "戳一下", "对方戳了你一下，通常是在打招呼、逗你或提醒你回消息"),
        Sticker("clapping_head", "拍一下", "对方拍了拍你，通常是打招呼、催你回消息或表达亲昵互动"),
        Sticker("water_gun", "皮一下", "对方和你开玩笑，气氛轻松调皮"),
        Sticker("cat_paw", "挠一下", "对方挠你一下，通常是调侃、逗趣或轻柔催促"),
        Sticker("pat_it", "摸一下", "对方摸摸你，通常表达安慰、关心或亲昵互动"),
        Sticker("zaiganma", "在干嘛", "对方问你在干嘛，想开启聊天或确认你有没有空"),
        Sticker("yyds", "YYDS", "对方夸你永远的神，表示强烈认可、夸赞或佩服"),
        Sticker("jyy", "加油鸭", "对方给你加油鼓励，表达支持"),
        Sticker("nice", "奈斯奈斯", "对方表示很好、很棒、赞同或满意"),
        Sticker("ylbz", "用力抱住", "对方想给你一个用力的拥抱，表达安慰、亲近或想念"),
        Sticker("jsdd", "举手dd", "对方举手报到，表示自己在线、愿意参与或主动打招呼"),
        Sticker("wndcall", "为你打Call", "对方给你应援打Call，表示支持、鼓励或赞赏"),
        Sticker("hahaha", "哈哈哈", "对方被逗笑或表示开心，气氛轻松"),
        Sticker("lvlvlv", "略略略", "对方在调皮吐槽、撒娇式挑衅或开玩笑"),
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
            for (sticker in STICKERS) {
                val fileName = "${sticker.type}.png"
                val exists = service.assets.list("sticker_ref")?.contains(fileName) == true
                if (!exists) continue
                service.assets.open("sticker_ref/$fileName").use { stream ->
                    val bitmap = BitmapFactory.decodeStream(stream) ?: return@use
                    map[sticker.type] = ReferenceTemplate(
                        normal = normalizedPixels(bitmap, mirror = false),
                        mirrored = normalizedPixels(bitmap, mirror = true)
                    )
                    bitmap.recycle()
                }
            }
        } catch (error: Exception) {
            Log.w("AIA", "Sticker warmup failed", error)
        }
        referenceTemplates = map
        Log.d("AIA", "StickerMatcher warmed up: ${map.size} references")
    }

    /** 单张兼容入口。 */
    suspend fun match(service: AccessibilityService, bounds: Rect): String? {
        return matchAll(service, listOf(bounds)).firstOrNull()
    }

    /**
     * 一次全屏截图后批量裁剪识别。
     * Android 对连续 takeScreenshot 有频率限制，不能一个表情截一次。
     */
    suspend fun matchAll(
        service: AccessibilityService,
        boundsList: List<Rect>
    ): List<String?> {
        if (boundsList.isEmpty()) return emptyList()
        warmup(service)
        val refs = referenceTemplates ?: return List(boundsList.size) { null }
        if (refs.isEmpty()) return List(boundsList.size) { null }

        val screen = takeFullScreenshotBitmap(service)
            ?: return List(boundsList.size) { null }
        return try {
            boundsList.map { bounds -> matchCropped(screen, bounds, refs) }
        } finally {
            screen.recycle()
        }
    }

    private fun matchCropped(
        source: Bitmap,
        bounds: Rect,
        refs: Map<String, ReferenceTemplate>
    ): String? {
        val cropped = cropBitmap(source, bounds) ?: return null
        return try {
            recognize(cropped, refs)
        } finally {
            cropped.recycle()
        }
    }

    private fun recognize(
        bitmap: Bitmap,
        refs: Map<String, ReferenceTemplate>
    ): String? {
        val target = normalizedPixels(bitmap, mirror = false)
        var bestType: String? = null
        var bestDist = Double.MAX_VALUE
        var secondBestDist = Double.MAX_VALUE
        for ((type, template) in refs) {
            val distance = minOf(
                differenceScore(target, template.normal),
                differenceScore(target, template.mirrored)
            )
            if (distance < bestDist) {
                secondBestDist = bestDist
                bestDist = distance
                bestType = type
            } else if (distance < secondBestDist) {
                secondBestDist = distance
            }
        }

        val gap = secondBestDist - bestDist
        val accepted = bestDist <= MAX_TEMPLATE_DISTANCE &&
            (gap >= MIN_BEST_GAP || bestDist <= STRONG_MATCH_DISTANCE)
        if (!accepted) {
            Log.d(
                "AIA",
                "Sticker no match, best=$bestType dist=%.2f gap=%.2f".format(bestDist, gap)
            )
            return null
        }

        val name = STICKERS.find { it.type == bestType }?.displayName ?: bestType
        Log.d(
            "AIA",
            "Sticker match: $bestType ($name) distance=%.2f gap=%.2f".format(bestDist, gap)
        )
        return name
    }

    private suspend fun takeFullScreenshotBitmap(service: AccessibilityService): Bitmap? {
        val result = suspendCancellableCoroutine<AccessibilityService.ScreenshotResult?> { continuation ->
            try {
                service.takeScreenshot(
                    android.view.Display.DEFAULT_DISPLAY,
                    service.mainExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                            if (continuation.isActive) {
                                continuation.resumeWith(Result.success(screenshot))
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            Log.w("AIA", "Sticker screenshot failed code=$errorCode")
                            if (continuation.isActive) {
                                continuation.resumeWith(Result.success(null))
                            }
                        }
                    }
                )
            } catch (error: Exception) {
                if (continuation.isActive) {
                    continuation.resumeWith(Result.success(null))
                }
            }
        } ?: return null

        return try {
            val hardwareBuffer = result.hardwareBuffer
            val wrapped = Bitmap.wrapHardwareBuffer(hardwareBuffer, result.colorSpace)
            hardwareBuffer.close()
            val software = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
            if (wrapped != null && wrapped !== software) wrapped.recycle()
            software
        } catch (error: Exception) {
            Log.w("AIA", "Sticker bitmap process failed", error)
            null
        }
    }

    private fun cropBitmap(source: Bitmap, bounds: Rect): Bitmap? {
        return try {
            val pad = 10
            val left = (bounds.left - pad).coerceIn(0, source.width - 1)
            val top = (bounds.top - pad).coerceIn(0, source.height - 1)
            val right = (bounds.right + pad).coerceIn(left + 1, source.width)
            val bottom = (bounds.bottom + pad).coerceIn(top + 1, source.height)
            Bitmap.createBitmap(source, left, top, right - left, bottom - top)
        } catch (error: Exception) {
            Log.w("AIA", "Sticker bitmap crop failed", error)
            null
        }
    }

    /** 去掉透明背景和空白边，缩放并居中，避免拉伸改变图案比例。 */
    private fun normalizedPixels(bitmap: Bitmap, mirror: Boolean): IntArray {
        val normalized = normalizeForTemplate(bitmap)
        val maxContentSize = TEMPLATE_SIZE - 4
        val scale = minOf(
            maxContentSize.toFloat() / normalized.width,
            maxContentSize.toFloat() / normalized.height
        )
        val targetWidth = (normalized.width * scale).roundToInt().coerceAtLeast(1)
        val targetHeight = (normalized.height * scale).roundToInt().coerceAtLeast(1)
        val scaled = Bitmap.createScaledBitmap(normalized, targetWidth, targetHeight, true)
        val canvasBitmap = Bitmap.createBitmap(
            TEMPLATE_SIZE,
            TEMPLATE_SIZE,
            Bitmap.Config.ARGB_8888
        )
        Canvas(canvasBitmap).apply {
            drawColor(Color.WHITE)
            drawBitmap(
                scaled,
                (TEMPLATE_SIZE - targetWidth) / 2f,
                (TEMPLATE_SIZE - targetHeight) / 2f,
                null
            )
        }

        try {
            val pixels = IntArray(TEMPLATE_SIZE * TEMPLATE_SIZE)
            canvasBitmap.getPixels(pixels, 0, TEMPLATE_SIZE, 0, 0, TEMPLATE_SIZE, TEMPLATE_SIZE)
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
            canvasBitmap.recycle()
            normalized.recycle()
        }
    }

    private fun differenceScore(first: IntArray, second: IntArray): Double {
        if (first.size != second.size) return Double.MAX_VALUE
        var total = 0L
        for (index in first.indices) {
            val a = first[index]
            val b = second[index]
            total += kotlin.math.abs(Color.red(a) - Color.red(b))
            total += kotlin.math.abs(Color.green(a) - Color.green(b))
            total += kotlin.math.abs(Color.blue(a) - Color.blue(b))
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
                val alpha = Color.alpha(color)
                val red = (Color.red(color) * alpha + 255 * (255 - alpha) + 127) / 255
                val green = (Color.green(color) * alpha + 255 * (255 - alpha) + 127) / 255
                val blue = (Color.blue(color) * alpha + 255 * (255 - alpha) + 127) / 255
                flattened[row + x] = Color.rgb(red, green, blue)
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

    private const val TEMPLATE_SIZE = 64
    private const val MAX_TEMPLATE_DISTANCE = 22.0
    private const val STRONG_MATCH_DISTANCE = 12.0
    private const val MIN_BEST_GAP = 1.0
}
