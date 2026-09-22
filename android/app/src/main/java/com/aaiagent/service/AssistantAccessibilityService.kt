package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.MessageEngine
import com.aaiagent.engine.EngineState
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.PlatformAdapter

class AssistantAccessibilityService : AccessibilityService() {

    lateinit var engine: MessageEngine
        private set
    lateinit var repository: AppRepository
        private set
    private lateinit var adapterRegistry: AdapterRegistry

    var isEnabled = false
        private set

    override fun onCreate() {
        super.onCreate()
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)
        engine = MessageEngine(this, repository)
        adapterRegistry = AdapterRegistry(this)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isEnabled = true
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
        val className = event.className?.toString() ?: ""
        val adapter = adapterRegistry.get(packageName) ?: return
        val root = rootInActiveWindow ?: return

        // 检测是否在聊天页
        val isInChatRoom = adapter.isInChat(root)
        engine.onPageChanged(isInChatRoom)

        if (!isInChatRoom) return

        // 在聊天页中，检查是否有新消息
        val messages = adapter.readMessages(root)
        for (msg in messages) {
            val msgInfo = PlatformAdapter.MessageInfo(
                id = packageName + "_" + msg.hashCode(),
                content = msg.content,
                sender = msg.sender
            )
            engine.onNewMessage(
                when (packageName) {
                    "cn.soulapp.android" -> "soul"
                    "com.tencent.mobileqq" -> "qq"
                    "com.immomo.momo" -> "immomo"
                    "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
                    else -> return
                },
                msgInfo
            )
        }
    }

    private fun handleContentChanged(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val adapter = adapterRegistry.get(packageName) ?: return
        val root = rootInActiveWindow ?: return

        if (!adapter.isInChat(root)) return

        val messages = adapter.readMessages(root)
        for (msg in messages) {
            val platform = when (packageName) {
                "cn.soulapp.android" -> "soul"
                "com.tencent.mobileqq" -> "qq"
                "com.immomo.momo" -> "immomo"
                "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
                else -> return
            }
            val msgInfo = PlatformAdapter.MessageInfo(
                id = packageName + "_" + msg.hashCode() + "_" + System.currentTimeMillis(),
                content = msg.content,
                sender = msg.sender
            )
            engine.onNewMessage(platform, msgInfo)
        }
    }

    override fun onInterrupt() {
        isEnabled = false
    }

    override fun onDestroy() {
        engine.shutdown()
        super.onDestroy()
    }
}
