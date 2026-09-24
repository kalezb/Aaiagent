package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

object ScreenCapture {
    suspend fun captureJpegBase64(
        service: AccessibilityService,
        targetBounds: Rect? = null,
        quality: Int = 72,
        rejectMostlyBlack: Boolean = false
    ): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null

        val screenshot = suspendCancellableCoroutine<AccessibilityService.ScreenshotResult?> { continuation ->
            try {
                service.takeScreenshot(
                    android.view.Display.DEFAULT_DISPLAY,
                    service.mainExecutor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                            if (continuation.isActive) continuation.resume(screenshot)
                        }

                        override fun onFailure(errorCode: Int) {
                            android.util.Log.w("AIA", "ScreenCapture failed code=$errorCode")
                            if (continuation.isActive) continuation.resume(null)
                        }
                    }
                )
            } catch (error: Exception) {
                android.util.Log.w("AIA", "ScreenCapture exception", error)
                if (continuation.isActive) continuation.resume(null)
            }
        } ?: return null

        return try {
            val hardwareBuffer = screenshot.hardwareBuffer
            val wrapped = Bitmap.wrapHardwareBuffer(hardwareBuffer, screenshot.colorSpace)
            hardwareBuffer.close()
            val software = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
            if (wrapped != null && wrapped !== software) wrapped.recycle()
            val bitmap = cropSafely(software ?: return null, targetBounds)
            val result = if (rejectMostlyBlack && isMostlyBlack(bitmap)) {
                android.util.Log.w("AIA", "ScreenCapture rejected a mostly black privacy frame")
                null
            } else {
                val output = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(35, 90), output)
                Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            }
            if (bitmap !== software) bitmap.recycle()
            software.recycle()
            result
        } catch (error: Exception) {
            android.util.Log.w("AIA", "ScreenCapture encode failed", error)
            null
        }
    }

    private fun isMostlyBlack(bitmap: Bitmap): Boolean {
        val stepX = maxOf(1, bitmap.width / 40)
        val stepY = maxOf(1, bitmap.height / 40)
        val samples = ArrayList<Int>(1_600)
        var y = 0
        while (y < bitmap.height) {
            var x = 0
            while (x < bitmap.width) {
                val color = bitmap.getPixel(x, y)
                val red = android.graphics.Color.red(color)
                val green = android.graphics.Color.green(color)
                val blue = android.graphics.Color.blue(color)
                samples.add((red * 299 + green * 587 + blue * 114) / 1_000)
                x += stepX
            }
            y += stepY
        }
        return ScreenCapturePolicy.isMostlyBlack(samples.toIntArray())
    }

    private fun cropSafely(bitmap: Bitmap, targetBounds: Rect?): Bitmap {
        if (targetBounds == null || targetBounds.isEmpty) return bitmap
        val padding = 90
        val left = (targetBounds.left - padding).coerceIn(0, bitmap.width - 1)
        val top = (targetBounds.top - padding).coerceIn(0, bitmap.height - 1)
        val right = (targetBounds.right + padding).coerceIn(left + 1, bitmap.width)
        val bottom = (targetBounds.bottom + padding).coerceIn(top + 1, bitmap.height)
        return Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
    }
}
