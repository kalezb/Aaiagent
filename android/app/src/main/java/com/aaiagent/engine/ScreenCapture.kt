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
        quality: Int = 72
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
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(35, 90), output)
            if (bitmap !== software) bitmap.recycle()
            software?.recycle()
            Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
        } catch (error: Exception) {
            android.util.Log.w("AIA", "ScreenCapture encode failed", error)
            null
        }
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
