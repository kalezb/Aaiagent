package com.aaiagent.engine

object HostingSessionPolicy {
    const val ENABLED_KEY = "hosting_enabled"
    const val PLATFORM_KEY = "hosting_platform"
    const val MODE_KEY = "hosting_mode"
    const val WEATHER_KEY = "weather_enabled"
    const val TIME_KEY = "time_enabled"

    data class Session(
        val platform: String,
        val mode: HostingMode
    )

    @Volatile
    private var activeSession: Session? = null

    @Volatile
    private var explicitlyStopped = false

    @Volatile
    private var selectedPlatform: String? = null

    fun selectPlatform(value: String?): String {
        val normalized = normalizePlatform(value)
        selectedPlatform = normalized
        return normalized
    }

    fun restoreSelectedPlatform(value: String?) {
        if (selectedPlatform == null) {
            selectedPlatform = normalizePlatform(value)
        }
    }

    fun selectedPlatform(): String? = selectedPlatform

    fun markStarted(platform: String, mode: HostingMode) {
        activeSession = Session(platform = selectPlatform(platform), mode = mode)
        explicitlyStopped = false
    }

    fun markStopped() {
        activeSession = null
        explicitlyStopped = true
    }

    fun processSession(): Session? = activeSession

    fun canRestoreFromPersistence(): Boolean = !explicitlyStopped

    fun shouldResume(enabledValue: String?, token: String?): Boolean {
        return enabledValue == "true" && !token.isNullOrBlank()
    }

    fun restoredSession(
        enabledValue: String?,
        token: String?,
        platformValue: String?,
        modeValue: String?
    ): Session? {
        if (!shouldResume(enabledValue, token)) return null
        return Session(
            platform = platformValue?.trim()?.ifBlank { null } ?: "soul",
            mode = hostingMode(modeValue)
        )
    }

    fun hostingMode(value: String?): HostingMode {
        return HostingMode.values().firstOrNull { it.name == value } ?: HostingMode.MONITOR_ONLY
    }

    fun effectiveMode(modeOverride: HostingMode?, persistedModeValue: String?): HostingMode {
        return modeOverride ?: hostingMode(persistedModeValue)
    }

    private fun normalizePlatform(value: String?): String {
        val normalized = value?.trim()?.lowercase().orEmpty()
        return normalized.takeIf { it in SUPPORTED_PLATFORMS } ?: "soul"
    }

    private val SUPPORTED_PLATFORMS = setOf("soul", "qq", "douban", "lianxin")
}
