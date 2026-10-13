package com.aaiagent

import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.data.repository.ContactListCodec
import com.aaiagent.network.ApiService
import com.aaiagent.ui.screens.ModelLineHealthState
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun MainActivity.toggleVoiceReply(enabled: Boolean) {
        voiceReplyEnabled = enabled
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(
                com.aaiagent.engine.VoiceReplyPolicy.ENABLED_KEY,
                enabled.toString()
            )
        }
        android.util.Log.d("AIA", "voice reply toggled enabled=$enabled")
    }

    /**
     * 配音方式：自动 / 注入 / 外放。
     *
     * 自动是默认 —— 能注入就注入（音质干净，需 root），否则用扬声器放出来录（不需 root）。
     * 手动锁定主要是为了在同一台手机上对比两种效果。
     */
internal fun MainActivity.changeVoiceOutputMode(mode: String) {
        voiceOutputMode = mode
        lifecycleScope.launch(Dispatchers.IO) {
            repository.setConfig(com.aaiagent.engine.VoiceOutputMode.CONFIG_KEY, mode)
        }
        android.util.Log.d("AIA", "voice output mode changed to $mode")
    }

    /**
     * 本机当前平台账号昵称，手填（见 SelfNicknamePolicy）。
     *
     * 界面上保留你正在打的原文，存进配置表的是清洗后的值（去换行、限长），
     * 这样边打边存也不会跟你抢输入。清空就是"不填"，后端不会注入昵称那段提示词。
     */
internal fun MainActivity.changeSelfNickname(value: String) {
        selfNickname = value
        val normalized = com.aaiagent.engine.SelfNicknamePolicy.normalize(value)
        lifecycleScope.launch(Dispatchers.IO) {
            val platform = repository.getConfig(HostingSessionPolicy.PLATFORM_KEY)
                ?.takeIf { it.isNotBlank() } ?: "soul"
            repository.setConfig(
                com.aaiagent.engine.SelfNicknamePolicy.configKey(platform),
                normalized
            )
        }
        android.util.Log.d("AIA", "self nickname changed length=${normalized.length}")
    }

internal fun MainActivity.syncPlatform(platform: String) {
        platformSyncStatus = "同步中..."
        lifecycleScope.launch {
            try { val r = ApiService(apiBase).saveConfig(token, mapOf("action" to "switch_platform", "platform" to platform)); platformSyncStatus = if (r.success) "✓ 已切换到${platformDisplayName(platform)}" else "✗ 切换失败" }
            catch (_: Exception) { platformSyncStatus = "✗ 切换失败" }
        }
    }

internal fun MainActivity.syncWeather() {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                repository.setConfig(HostingSessionPolicy.WEATHER_KEY, weatherEnabled.toString())
            }
            try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_weather", "enabled" to weatherEnabled.toString())) } catch (_: Exception) {}
        }
    }

internal fun MainActivity.syncLine() {
        val line = if (lineA) "a" else "b"
        val lineName = if (lineA) "线路A" else "线路B"
        lifecycleScope.launch {
            withContext(Dispatchers.IO) { repository.setConfig(MainActivity.MODEL_LINE_KEY, line) }
            setLineHealth(line, ModelLineHealthState.CHECKING, "正在保存并检测 $lineName…")
            if (token.isBlank()) {
                setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 保存失败：请先验证设备钥匙")
                return@launch
            }
            val saveResult = runCatching {
                ApiService(apiBase).saveConfig(token, mapOf("action" to "switch_line", "line" to line))
            }.getOrElse {
                setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 保存失败：${it.message ?: "网络错误"}")
                return@launch
            }
            if (!saveResult.success) {
                setLineHealth(
                    line,
                    ModelLineHealthState.FAILED,
                    "✗ $lineName 保存失败：${
                        listOf(saveResult.error, saveResult.message).firstOrNull { !it.isNullOrBlank() }
                            ?: "云端未确认"
                    }"
                )
                return@launch
            }
            checkModelLineHealth(line)
        }
    }

internal fun MainActivity.checkSelectedLineHealth() {
        val line = if (lineA) "a" else "b"
        lifecycleScope.launch { checkModelLineHealth(line) }
    }

internal suspend fun MainActivity.checkModelLineHealth(line: String) {
        val lineName = if (line == "b") "线路B" else "线路A"
        setLineHealth(line, ModelLineHealthState.CHECKING, "正在检测 $lineName…")
        if (token.isBlank()) {
            setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 连接失败：请先验证设备钥匙")
            return
        }
        val result = runCatching {
            ApiService(apiBase).checkModelRouteHealth(token, line)
        }.getOrElse {
            com.aaiagent.network.ModelRouteHealthResponse(
                ok = false,
                line = line,
                error = it.message ?: "网络错误"
            )
        }
        if (result.ok) {
            val latency = result.latencyMs?.let { " · ${it}ms" }.orEmpty()
            setLineHealth(line, ModelLineHealthState.CONNECTED, "✓ $lineName 已连接$latency")
        } else {
            setLineHealth(line, ModelLineHealthState.FAILED, "✗ $lineName 连接失败：${result.error ?: "线路不可用"}")
        }
    }

internal fun MainActivity.setLineHealth(line: String, state: ModelLineHealthState, message: String) {
        if (line == "b") {
            lineHealthB = state
        } else {
            lineHealthA = state
        }
        if ((lineA && line == "a") || (!lineA && line == "b")) {
            lineHealthMessage = message
        }
    }

internal fun MainActivity.syncTime() {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                repository.setConfig(HostingSessionPolicy.TIME_KEY, timeEnabled.toString())
            }
            try { ApiService(apiBase).saveConfig(token, mapOf("action" to "toggle_time", "enabled" to timeEnabled.toString())) } catch (_: Exception) {}
        }
    }

internal fun MainActivity.updateContactWhitelist(values: List<String>) {
        val normalized = ContactListCodec.normalize(values)
        contactWhitelist = normalized
        lifecycleScope.launch(Dispatchers.IO) { repository.setContactWhitelist(normalized) }
    }

internal fun MainActivity.updateContactBlacklist(values: List<String>) {
        val normalized = ContactListCodec.normalize(values)
        contactBlacklist = normalized
        lifecycleScope.launch(Dispatchers.IO) { repository.setContactBlacklist(normalized) }
    }

internal fun MainActivity.platformDisplayName(p: String) = when(p) { "soul" -> "Soul"; "qq" -> "QQ"; "douban" -> "豆瓣"; "lianxin" -> "连信"; else -> p }
