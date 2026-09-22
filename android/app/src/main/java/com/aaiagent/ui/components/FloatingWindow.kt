package com.aaiagent.ui.components

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager

class FloatingWindow(private val context: Context) {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var isVisible = false
    private var isHosting = false
    private var onToggle: ((Boolean) -> Unit)? = null
    private var onLongClick: (() -> Unit)? = null

    companion object {
        private val GREEN = android.graphics.Color.parseColor("#22C55E")
        private val GRAY = android.graphics.Color.parseColor("#9CA3AF")
        private val RED = android.graphics.Color.parseColor("#EF4444")
    }

    fun show(hosting: Boolean, toggleListener: (Boolean) -> Unit, longClickListener: () -> Unit) {
        if (isVisible) return
        isHosting = hosting
        onToggle = toggleListener
        onLongClick = longClickListener

        windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val floatingDot = View(context).apply {
            setBackgroundColor(if (isHosting) GREEN else GRAY)
            layoutParams = WindowManager.LayoutParams(
                48,
                48,
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
                setBackgroundColor(if (isHosting) GREEN else GRAY)
                onToggle?.invoke(isHosting)
            }

            setOnLongClickListener {
                onLongClick?.invoke()
                true
            }

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
        floatingView?.setBackgroundColor(if (hosting) GREEN else GRAY)
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
