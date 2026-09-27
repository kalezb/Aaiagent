package com.aaiagent.ui.components

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.aaiagent.R
import kotlin.math.abs

class FloatingWindow(private val context: Context) {

    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("floating_window", Context.MODE_PRIVATE)
    private var windowManager: WindowManager? = null
    private var floatingView: LinearLayout? = null
    private var iconView: ImageView? = null
    private var labelView: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var isVisible = false
    private var isHosting = false
    private var status = FloatingWindowStatus.OFF
    private var onToggle: ((Boolean) -> Unit)? = null
    private var onLongClick: (() -> Unit)? = null

    fun show(
        hosting: Boolean,
        toggleListener: (Boolean) -> Unit,
        longClickListener: () -> Unit
    ): Boolean {
        if (isVisible) {
            updateHostingState(hosting)
            return true
        }
        if (!Settings.canDrawOverlays(appContext)) return false

        onToggle = toggleListener
        onLongClick = longClickListener
        windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager

        val icon = ImageView(appContext).apply {
            setImageResource(R.drawable.ic_floating_power)
            layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
        }
        val label = TextView(appContext).apply {
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14.5f)
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            isSingleLine = true
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dp(8) }
        }
        val root = LinearLayout(appContext).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            minimumWidth = dp(174)
            setPadding(dp(14), 0, dp(14), 0)
            isClickable = true
            isFocusable = true
            elevation = dp(10).toFloat()
            outlineProvider = ViewOutlineProvider.BACKGROUND
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            addView(icon)
            addView(label)
        }

        val windowParams = WindowManager.LayoutParams(
            dp(174),
            dp(58),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            x = preferences.getInt(POSITION_X, dp(10)).coerceIn(0, maxHorizontalOffset())
            y = preferences.getInt(POSITION_Y, dp(180)).coerceIn(-maxVerticalOffset(), maxVerticalOffset())
            title = "AI托管快捷开关"
        }

        iconView = icon
        labelView = label
        floatingView = root
        params = windowParams
        updateHostingState(hosting)
        installTouchHandling(root)

        return runCatching {
            windowManager?.addView(root, windowParams)
            isVisible = true
            true
        }.getOrElse {
            floatingView = null
            iconView = null
            labelView = null
            params = null
            false
        }
    }

    fun updateHostingState(hosting: Boolean) {
        isHosting = hosting
        updateStatus(if (hosting) FloatingWindowStatus.ON else FloatingWindowStatus.OFF)
    }

    fun updateStatus(nextStatus: FloatingWindowStatus) {
        status = nextStatus
        when (nextStatus) {
            FloatingWindowStatus.ON -> isHosting = true
            FloatingWindowStatus.OFF -> isHosting = false
            FloatingWindowStatus.BUSY_ON, FloatingWindowStatus.BUSY_OFF -> Unit
        }
        updateVisuals()
    }

    fun hide() {
        runCatching {
            floatingView?.let { windowManager?.removeView(it) }
        }
        floatingView = null
        iconView = null
        labelView = null
        params = null
        isVisible = false
    }

    fun isShowing(): Boolean = isVisible

    private fun updateVisuals() {
        val root = floatingView ?: return
        val icon = iconView ?: return
        val label = labelView ?: return
        val enabled = status == FloatingWindowStatus.ON || status == FloatingWindowStatus.BUSY_ON
        val gradient = GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            if (enabled) {
                intArrayOf(0xFF1479EA.toInt(), 0xFF22A7F3.toInt())
            } else {
                intArrayOf(0xFFFFFFFF.toInt(), 0xFFEAF3FF.toInt())
            }
        ).apply {
            cornerRadius = dp(29).toFloat()
            if (!enabled) setStroke(dp(1), 0xFFC9E0F7.toInt())
        }
        root.background = RippleDrawable(
            ColorStateList.valueOf(if (enabled) 0x33FFFFFF else 0x221479EA),
            gradient,
            null
        )
        root.contentDescription = status.label
        label.text = status.label
        label.setTextColor(if (enabled) android.graphics.Color.WHITE else 0xFF226094.toInt())
        icon.setColorFilter(if (enabled) android.graphics.Color.WHITE else 0xFF2D8FEA.toInt())
    }

    private fun installTouchHandling(root: LinearLayout) {
        val touchSlop = ViewConfiguration.get(appContext).scaledTouchSlop
        val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()
        var initialX = 0
        var initialY = 0
        var touchX = 0f
        var touchY = 0f
        var downAt = 0L
        var dragging = false

        root.setOnClickListener {
            onToggle?.invoke(!isHosting)
        }
        root.setOnLongClickListener {
            onLongClick?.invoke()
            true
        }
        root.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    val current = params ?: return@setOnTouchListener false
                    initialX = current.x
                    initialY = current.y
                    touchX = event.rawX
                    touchY = event.rawY
                    downAt = event.eventTime
                    dragging = false
                    view.isPressed = true
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                        dragging = true
                    }
                    if (dragging) {
                        val current = params ?: return@setOnTouchListener false
                        current.x = clamp(initialX - dx, 0, maxHorizontalOffset())
                        current.y = clamp(initialY + dy, -maxVerticalOffset(), maxVerticalOffset())
                        windowManager?.updateViewLayout(view, current)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    view.isPressed = false
                    if (!dragging) {
                        if (event.eventTime - downAt >= longPressTimeout) {
                            view.performLongClick()
                        } else {
                            view.performClick()
                        }
                    } else {
                        persistPosition()
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    view.isPressed = false
                    if (dragging) persistPosition()
                    true
                }

                else -> true
            }
        }
    }

    private fun persistPosition() {
        val current = params ?: return
        preferences.edit().putInt(POSITION_X, current.x).putInt(POSITION_Y, current.y).apply()
    }

    private fun maxHorizontalOffset(): Int {
        val screenWidth = appContext.resources.displayMetrics.widthPixels
        return (screenWidth - dp(174) - dp(8)).coerceAtLeast(0)
    }

    private fun maxVerticalOffset(): Int {
        val screenHeight = appContext.resources.displayMetrics.heightPixels
        return ((screenHeight - dp(58)) / 2 - dp(8)).coerceAtLeast(0)
    }

    private fun clamp(value: Int, min: Int, max: Int): Int = value.coerceIn(min, max)

    private fun dp(value: Int): Int =
        (value * appContext.resources.displayMetrics.density).toInt()

    private companion object {
        const val POSITION_X = "position_x"
        const val POSITION_Y = "position_y"
    }
}
