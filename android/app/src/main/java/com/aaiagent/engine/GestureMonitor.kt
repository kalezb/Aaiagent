package com.aaiagent.engine

object GestureMonitor {
    private var lastTouchTime = 0L

    fun onTouchDetected() {
        lastTouchTime = System.currentTimeMillis()
    }

    fun isUserTouchingRecently(windowMs: Long): Boolean {
        return System.currentTimeMillis() - lastTouchTime < windowMs
    }
}
