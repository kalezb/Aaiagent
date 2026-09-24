package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.EngineState
import com.aaiagent.engine.MessageEngine

class AssistantAccessibilityService : AccessibilityService() {

    lateinit var engine: MessageEngine
        private set
    lateinit var repository: AppRepository
        private set
    private lateinit var adapterRegistry: AdapterRegistry

    var isEnabled = false
        private set

    override fun onCreate() {
        android.util.Log.d("AIA", "AccessibilityService onCreate START")
        super.onCreate()
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
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_LONG_CLICKED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_SCROLLED,
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_START,
            AccessibilityEvent.TYPE_TOUCH_INTERACTION_END -> engine.onUserInteraction()
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
        super.onDestroy()
    }

    companion object {
        var sharedEngine: MessageEngine? = null
            private set

        fun setSharedEngine(engine: MessageEngine) {
            sharedEngine = engine
        }
    }
}
