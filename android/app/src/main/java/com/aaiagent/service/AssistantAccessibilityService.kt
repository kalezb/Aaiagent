package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.EngineState
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.engine.MessageEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AssistantAccessibilityService : AccessibilityService() {

    lateinit var engine: MessageEngine
        private set
    lateinit var repository: AppRepository
        private set
    private lateinit var adapterRegistry: AdapterRegistry
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var inheritedSession: HostingSessionPolicy.Session? = null

    var isEnabled = false
        private set

    override fun onCreate() {
        android.util.Log.d("AIA", "AccessibilityService onCreate START")
        super.onCreate()

        inheritedSession = sharedEngine?.takeIf { it.hostingEnabled }?.let {
            HostingSessionPolicy.Session(it.currentPlatform, it.hostingMode)
        } ?: HostingSessionPolicy.processSession()

        sharedEngine?.shutdown()
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)
        engine = MessageEngine(this, repository)
        adapterRegistry = AdapterRegistry(this)
        setSharedEngine(engine)

        android.util.Log.d("AIA", "AccessibilityService onCreate DONE")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isEnabled = true
        android.util.Log.d("AIA", "AccessibilityService onServiceConnected DONE")
        if (engine.hostingEnabled) return

        inheritedSession?.let {
            inheritedSession = null
            startHostingSession(it, source = "service-recreated")
            return
        }

        if (!HostingSessionPolicy.canRestoreFromPersistence()) {
            android.util.Log.d("AIA", "hosting restore skipped because user stopped it in this process")
            return
        }

        serviceScope.launch {
            val saved = withContext(Dispatchers.IO) {
                Quadruple(
                    repository.getConfig(HostingSessionPolicy.ENABLED_KEY),
                    repository.getActiveToken()?.token?.trim(),
                    repository.getConfig(HostingSessionPolicy.PLATFORM_KEY),
                    repository.getConfig(HostingSessionPolicy.MODE_KEY)
                )
            }
            val session = HostingSessionPolicy.restoredSession(
                enabledValue = saved.first,
                token = saved.second,
                platformValue = saved.third,
                modeValue = saved.fourth
            )
            if (session == null) {
                android.util.Log.d(
                    "AIA",
                    "hosting restore skipped enabled=${saved.first} hasToken=${!saved.second.isNullOrBlank()}"
                )
                return@launch
            }
            startHostingSession(session, source = "persisted-session")
        }
    }

    private fun startHostingSession(session: HostingSessionPolicy.Session, source: String) {
        HostingSessionPolicy.markStarted(session.platform, session.mode)
        engine.hostingMode = session.mode
        engine.startHosting(session.platform)
        android.util.Log.d(
            "AIA",
            "hosting session restored source=$source platform=${session.platform} mode=${session.mode}"
        )
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || !isEnabled) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> handleWindowStateChanged(event)
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                event.packageName?.toString()
                    ?.let(::platformForPackage)
                    ?.let(engine::onContentChanged)
            }
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_START -> engine.onUserInteraction()
        }
    }

    private fun handleWindowStateChanged(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val adapter = adapterRegistry.get(packageName) ?: return
        val root = rootInActiveWindow ?: return
        val platform = platformForPackage(packageName) ?: return
        val isInChatRoom = adapter.isInChat(root)
        engine.onPageChanged(isInChatRoom)

        android.util.Log.d(
            "AIA",
            "WindowStateChanged: pkg=$packageName plat=$platform isInChat=$isInChatRoom hosting=${engine.hostingEnabled}"
        )

        if (engine.hostingEnabled && !isInChatRoom && engine.currentState() == EngineState.Idle) {
            if (adapter.isInMessageList(root)) {
                android.util.Log.d("AIA", "WindowStateChanged: on message list, polling handles it")
            }
        }
    }

    private fun platformForPackage(packageName: String): String? = when (packageName) {
        "cn.soulapp.android" -> "soul"
        "com.tencent.mobileqq" -> "qq"
        "com.immomo.momo" -> "immomo"
        "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
        else -> null
    }

    override fun onInterrupt() {
        android.util.Log.d("AIA", "AccessibilityService onInterrupt")
        isEnabled = false
    }

    override fun onDestroy() {
        engine.shutdown()
        serviceScope.cancel()
        clearSharedEngine(engine)
        super.onDestroy()
    }

    companion object {
        var sharedEngine: MessageEngine? = null
            private set

        fun setSharedEngine(engine: MessageEngine) {
            sharedEngine = engine
        }

        fun clearSharedEngine(engine: MessageEngine) {
            if (sharedEngine === engine) sharedEngine = null
        }
    }

    private data class Quadruple<A, B, C, D>(
        val first: A,
        val second: B,
        val third: C,
        val fourth: D
    )
}
