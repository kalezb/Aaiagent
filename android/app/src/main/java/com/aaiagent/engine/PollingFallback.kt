package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter
import kotlinx.coroutines.*

object PollingFallback {
    private var job: Job? = null
    private var failCount = 0
    private val threshold = 10
    private val intervalMs = 30_000L

    fun onNotificationReceived() {
        failCount = 0
    }

    fun onNotificationFailed() {
        failCount++
    }

    fun shouldEnablePolling(): Boolean = failCount >= threshold

    fun startPolling(
        scope: CoroutineScope,
        adapter: PlatformAdapter,
        onFound: (PlatformAdapter.MessageInfo) -> Unit
    ) {
        if (job?.isActive == true) return
        job = scope.launch {
            while (isActive) {
                delay(intervalMs)
                // 轮询逻辑由外层的 AccessibilityService 触发
            }
        }
    }

    fun stopPolling() {
        job?.cancel()
    }

    fun reset() {
        failCount = 0
        stopPolling()
    }
}
