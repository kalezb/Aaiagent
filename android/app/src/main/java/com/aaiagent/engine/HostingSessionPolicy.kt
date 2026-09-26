package com.aaiagent.engine

object HostingSessionPolicy {
    const val ENABLED_KEY = "hosting_enabled"
    const val PLATFORM_KEY = "hosting_platform"
    const val MODE_KEY = "hosting_mode"

    data class Session(
        val platform: String,
        val mode: HostingMode
    )

    @Volatile
    private var activeSession: Session? = null

    @Volatile
    private var explicitlyStopped = false

    fun markStarted(platform: String, mode: HostingMode) {
        activeSession = Session(platform = platform.trim().ifBlank { "soul" }, mode = mode)
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
        return HostingMode.values().firstOrNull { it.name == value } ?: HostingMode.FULL_AUTO
    }
}
