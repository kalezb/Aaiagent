package com.aaiagent.service

import android.content.Context
import android.content.Intent
import android.widget.Toast
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.HostingControlPolicy
import com.aaiagent.engine.HostingMode
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.engine.HostingStartNoticePolicy
import com.aaiagent.network.ApiService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object HostingController {
    const val ACTION_HOSTING_STATE_CHANGED = "com.aaiagent.HOSTING_STATE_CHANGED"
    const val EXTRA_HOSTING_ENABLED = "hosting_enabled"

    data class Result(
        val success: Boolean,
        val enabled: Boolean,
        val message: String
    )

    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var blacklistSyncJob: Job? = null

    suspend fun setHosting(
        context: Context,
        enable: Boolean,
        platformOverride: String? = null,
        modeOverride: HostingMode? = null
    ): Result {
        val appContext = context.applicationContext
        val repository = AppRepository(AppDatabase.getInstance(appContext))
        val token = withContext(Dispatchers.IO) {
            repository.getActiveToken()?.token?.trim().orEmpty()
        }
        val platform = platformOverride
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: HostingSessionPolicy.selectedPlatform()
            ?: withContext(Dispatchers.IO) {
                repository.getConfig(HostingSessionPolicy.PLATFORM_KEY)
            }?.trim()?.takeIf { it.isNotBlank() }
            ?: "soul"
        val persistedModeValue = if (modeOverride == null) {
            withContext(Dispatchers.IO) { repository.getConfig(HostingSessionPolicy.MODE_KEY) }
        } else {
            null
        }
        val mode = HostingSessionPolicy.effectiveMode(modeOverride, persistedModeValue)
        android.util.Log.d(
            "AIA",
            "Hosting toggle requested enable=$enable source=${if (modeOverride == null) "floating" else "main"} platform=$platform mode=$mode persistedMode=$persistedModeValue"
        )

        ForegroundService.ensureRunning(appContext)

        if (enable) {
            val failure = HostingControlPolicy.startFailure(
                hasToken = token.isNotBlank(),
                accessibilityReady = AssistantAccessibilityService.sharedEngine != null
            )
            if (failure != null) {
                publishState(appContext, enabled = false)
                return Result(success = false, enabled = false, message = failure)
            }

            withContext(Dispatchers.IO) {
                repository.setConfig(HostingSessionPolicy.PLATFORM_KEY, platform)
                repository.setConfig(HostingSessionPolicy.MODE_KEY, mode.name)
                repository.setConfig(HostingSessionPolicy.ENABLED_KEY, "true")
            }

            val started = withContext(Dispatchers.Main.immediate) {
                val engine = AssistantAccessibilityService.sharedEngine ?: return@withContext false
                engine.hostingMode = mode
                engine.startHosting(platform)
                true
            }
            if (!started) {
                withContext(Dispatchers.IO) {
                    repository.setConfig(HostingSessionPolicy.ENABLED_KEY, "false")
                }
                HostingSessionPolicy.markStopped()
                publishState(appContext, enabled = false)
                return Result(success = false, enabled = false, message = "无障碍服务未启动")
            }

            HostingSessionPolicy.markStarted(platform, mode)
            publishState(appContext, enabled = true)
            backgroundScope.launch {
                val filters = runCatching {
                    repository.getContactWhitelist() to repository.getContactBlacklist()
                }.getOrNull()
                val notice = filters?.let { (white, black) ->
                    HostingStartNoticePolicy.notice(white, black)
                }.orEmpty()
                if (notice.isNotBlank()) {
                    withContext(Dispatchers.Main.immediate) {
                        Toast.makeText(appContext, notice, Toast.LENGTH_LONG).show()
                    }
                }
                syncBackend(repository, token, enabled = true)
            }
            blacklistSyncJob?.cancel()
            blacklistSyncJob = backgroundScope.launch {
                val effectiveToken = token.ifBlank {
                    withContext(Dispatchers.IO) {
                        repository.getActiveToken()?.token?.trim().orEmpty()
                    }
                }
                while (effectiveToken.isNotBlank()) {
                    runCatching {
                        val apiBase = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
                        val config = ApiService(apiBase).getConfig(effectiveToken)
                        config.contactBlacklist?.let { serverBlacklist ->
                            val normalized = com.aaiagent.data.repository.ContactListCodec.normalize(serverBlacklist)
                            withContext(Dispatchers.IO) {
                                repository.setContactBlacklist(normalized)
                            }
                        }
                    }
                    kotlinx.coroutines.delay(15_000L)
                }
            }
            return Result(success = true, enabled = true, message = "已开启 AI 托管")
        }

        blacklistSyncJob?.cancel()
        blacklistSyncJob = null
        withContext(Dispatchers.Main.immediate) {
            AssistantAccessibilityService.sharedEngine?.let { engine ->
                engine.stopHosting()
                engine.clearRecoveryState()
            }
        }
        HostingSessionPolicy.markStopped()
        withContext(Dispatchers.IO) {
            repository.setConfig(HostingSessionPolicy.PLATFORM_KEY, platform)
            repository.setConfig(HostingSessionPolicy.MODE_KEY, mode.name)
            repository.setConfig(HostingSessionPolicy.ENABLED_KEY, "false")
        }
        publishState(appContext, enabled = false)
        backgroundScope.launch {
            syncBackend(repository, token, enabled = false)
        }
        return Result(success = true, enabled = false, message = "已关闭 AI 托管")
    }

    private suspend fun syncBackend(
        repository: AppRepository,
        token: String,
        enabled: Boolean
    ) {
        val effectiveToken = token.ifBlank {
            withContext(Dispatchers.IO) {
                repository.getActiveToken()?.token?.trim().orEmpty()
            }
        }
        if (effectiveToken.isBlank()) return
        runCatching {
            val apiBase = withContext(Dispatchers.IO) { repository.getApiBaseUrl() }
            ApiService(apiBase).saveConfig(
                effectiveToken,
                mapOf("action" to "toggle_hosting", "enabled" to enabled.toString())
            )
        }
    }

    private fun publishState(context: Context, enabled: Boolean) {
        context.sendBroadcast(
            Intent(ACTION_HOSTING_STATE_CHANGED)
                .setPackage(context.packageName)
                .putExtra(EXTRA_HOSTING_ENABLED, enabled)
        )
    }
}
