package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.MessageEngine
import com.aaiagent.engine.EngineState
import com.aaiagent.adapter.AdapterRegistry

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
        try {
            super.onCreate()
            android.util.Log.d("AIA", "AccessibilityService super.onCreate OK")
            val db = AppDatabase.getInstance(this)
            android.util.Log.d("AIA", "AccessibilityService DB OK")
            repository = AppRepository(db)
            android.util.Log.d("AIA", "AccessibilityService repository OK")
            engine = MessageEngine(this, repository)
            android.util.Log.d("AIA", "AccessibilityService engine OK")
            setSharedEngine(engine)
            adapterRegistry = AdapterRegistry(this)
            android.util.Log.d("AIA", "AccessibilityService onCreate DONE")
        } catch (e: Exception) {
            android.util.Log.e("AIA", "AccessibilityService onCreate CRASHED", e)
            throw e
        }
    }

    override fun onServiceConnected() {
        android.util.Log.d("AIA", "AccessibilityService onServiceConnected START")
        try {
            super.onServiceConnected()
            isEnabled = true
            android.util.Log.d("AIA", "AccessibilityService onServiceConnected DONE, isEnabled=$isEnabled")
        } catch (e: Exception) {
            android.util.Log.e("AIA", "AccessibilityService onServiceConnected CRASHED", e)
            throw e
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (!isEnabled) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                handleWindowStateChanged(event)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                handleContentChanged(event)
            }
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_LONG_CLICKED -> {
                engine.onUserInteraction()
            }
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                engine.onUserInteraction()
            }
        }
    }

    private fun handleWindowStateChanged(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val adapter = adapterRegistry.get(packageName) ?: return
        val root = rootInActiveWindow ?: return

        // \u53EA\u68C0\u6D4B\u9875\u9762\u53D8\u5316\uFF0C\u4E0D\u4E3B\u52A8\u8BFB\u6D88\u606F
        // \u6D88\u606F\u8BFB\u53D6\u7531 MessageEngine \u5728\u5904\u7406\u6D41\u7A0B\u4E2D\u8C03\u7528 adapter.readMessages()
        val isInChatRoom = adapter.isInChat(root)
        engine.onPageChanged(isInChatRoom)

        val platform = when (packageName) {
            "cn.soulapp.android" -> "soul"
            "com.tencent.mobileqq" -> "qq"
            "com.immomo.momo" -> "immomo"
            "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
            else -> return
        }

        android.util.Log.d("AIA", "WindowStateChanged: pkg=$packageName plat=$platform isInChat=$isInChatRoom hosting=${engine.hostingEnabled}")

        if (engine.hostingEnabled && !isInChatRoom && engine.currentState() == EngineState.Idle) {
            val isInMsgList = adapter.isInMessageList(root)
            if (isInMsgList) {
                android.util.Log.d("AIA", "Auto-triggering scan for $platform")
                engine.startHosting(platform)
            }
        }
    }

    private fun handleContentChanged(event: AccessibilityEvent) {
        // \u5185\u5BB9\u53D8\u5316\u53EF\u80FD\u662F\u65B0\u6D88\u606F\u5230\u6765
        // \u4F46\u4E3B\u8981\u89E6\u53D1\u5E94\u7531 NotificationListener \u8D1F\u8D23
        // \u8FD9\u91CC\u4EC5\u68C0\u6D4B\u7528\u6237\u4EA4\u4E92\uFF08\u89E6\u6478\u5C4F\u5E55\uFF09
        engine.onUserInteraction()
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
