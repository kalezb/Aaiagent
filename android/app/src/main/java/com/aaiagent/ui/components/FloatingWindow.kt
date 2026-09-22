package com.aaiagent.ui.components

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import androidx.core.content.ContextCompat
import com.aaiagent.ui.theme.Green
import com.aaiagent.ui.theme.Gray

class FloatingWindow(private val context: Context) {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var isVisible = false
    private var isHosting = false
    private var onToggle: ((Boolean) -> Unit)? = null
    private var onLongClick: (() -> Unit)? = null

    fun show(hosting: Boolean, toggleListener: (Boolean) -> Unit, longClickListener: () -> Unit) {
        if (isVisible) return
        isHosting = hosting
        onToggle = toggleListener
        onLongClick = longClickListener

        windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val floatingDot = View(context).apply {
            setBackgroundColor(if (isHosting) Green.toArgb() else Gray.toArgb())
            layoutParams = WindowManager.LayoutParams(
                24,
                24,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                else WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                x = 8
                y = 0
            }

            setOnClickListener {
                isHosting = !isHosting
                setBackgroundColor(if (isHosting) Green.toArgb() else Gray.toArgb())
                onToggle?.invoke(isHosting)
            }

            setOnLongClickListener {
                onLongClick?.invoke()
                true
            }

            // 拖动支持
            var initialX = 0
            var initialY = 0
            var initialTouchX = 0f
            var initialTouchY = 0f

            setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = (layoutParams as WindowManager.LayoutParams).x
                        initialY = (layoutParams as WindowManager.LayoutParams).y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - initialTouchX).toInt()
                        val dy = (event.rawY - initialTouchY).toInt()
                        (layoutParams as WindowManager.LayoutParams).x = initialX - dx
                        (layoutParams as WindowManager.LayoutParams).y = initialY + dy
                        windowManager?.updateViewLayout(this, layoutParams)
                        true
                    }
                    else -> false
                }
            }
        }

        floatingView = floatingDot
        windowManager?.addView(floatingDot, floatingDot.layoutParams)
        isVisible = true
    }

    fun updateHostingState(hosting: Boolean) {
        isHosting = hosting
        floatingView?.setBackgroundColor(if (hosting) Green.toArgb() else Gray.toArgb())
    }

    fun hide() {
        try {
            floatingView?.let { windowManager?.removeView(it) }
        } catch (_: Exception) {}
        floatingView = null
        isVisible = false
    }

    fun isShowing(): Boolean = isVisible
}