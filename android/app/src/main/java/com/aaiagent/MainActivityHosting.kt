package com.aaiagent

import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.service.HostingController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun MainActivity.selectHostingMode(mode: HostingMode) {
        hostingMode = mode
        val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine
        if (engine?.hostingEnabled == true) {
            engine.hostingMode = mode
            HostingSessionPolicy.markStarted(engine.currentPlatform, mode)
        }
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(HostingSessionPolicy.MODE_KEY, mode.name)
        }
        android.util.Log.d("AIA", "Hosting mode selected mode=$mode persisted=true")
    }

internal fun MainActivity.toggleHosting(enable: Boolean) {
        val platform = HostingSessionPolicy.selectedPlatform()
            ?: enabledPlatforms.firstOrNull()
            ?: "soul"
        val mode = hostingMode
        val activity = this
        android.util.Log.d("AIA", "Hosting toggle requested enable=$enable source=main platform=$platform mode=$mode")
        isHosting = enable
        engineState = if (enable) "启动中..." else "正在关闭..."
        lifecycleScope.launch {
            val result = HostingController.setHosting(
                context = activity,
                enable = enable,
                platformOverride = platform,
                modeOverride = mode
            )
            isHosting = result.enabled
            engineState = result.message
            if (result.success && result.enabled) {
                com.aaiagent.service.AssistantAccessibilityService.sharedEngine?.let {
                    startHostingPolling(it)
                }
            } else if (!result.enabled) {
                statePollJob?.cancel()
            }
            if (!result.success && enable) {
                tokenVerifyStatus = "✗ ${result.message}"
            }
        }
    }
internal fun MainActivity.startHostingPolling(engine: com.aaiagent.engine.MessageEngine) {
        statePollJob?.cancel()
        statePollJob = lifecycleScope.launch {
            while (isHosting) {
                engineState = engine.currentState().toString()
                kotlinx.coroutines.delay(500)
            }
        }
    }

internal fun MainActivity.resumeRequestedHosting() {
        lifecycleScope.launch {
            val engine = com.aaiagent.service.AssistantAccessibilityService.sharedEngine ?: return@launch
            if (engine.hostingEnabled) return@launch

            val session = HostingSessionPolicy.processSession() ?: run {
                if (!HostingSessionPolicy.canRestoreFromPersistence()) return@launch
                val saved = withContext(Dispatchers.IO) {
                    listOf(
                        repository.getConfig(HostingSessionPolicy.ENABLED_KEY),
                        repository.getActiveToken()?.token?.trim(),
                        repository.getConfig(HostingSessionPolicy.PLATFORM_KEY),
                        repository.getConfig(HostingSessionPolicy.MODE_KEY)
                    )
                }
                HostingSessionPolicy.restoredSession(
                    enabledValue = saved[0],
                    token = saved[1],
                    platformValue = saved[2],
                    modeValue = saved[3]
                )
            } ?: return@launch

            engine.hostingMode = session.mode
            engine.startHosting(session.platform)
            HostingSessionPolicy.markStarted(session.platform, session.mode)
            isHosting = true
            hostingMode = session.mode
            startHostingPolling(engine)
        }
    }
