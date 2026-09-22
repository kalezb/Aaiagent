package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.MessageEngine

class AssistantAccessibilityService : AccessibilityService() {

    lateinit var engine: MessageEngine
        private set
    lateinit var repository: AppRepository
        private set

    var isEnabled = false
        private set

    override fun onCreate() {
        super.onCreate()
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)
        engine = MessageEngine(this, repository)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isEnabled = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (!isEnabled) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                handleWindowChange(event)
            }
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_LONG_CLICKED -> {
                engine.onUserInteraction()
            }
        }
    }

    private fun handleWindowChange(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val root = rootInActiveWindow ?: return

        val platform = when {
            packageName == "com.soulapp.cn" -> "soul"
            packageName == "com.tencent.mobileqq" -> "qq"
            packageName == "com.immomo.momo" -> "immomo"
            packageName == "com.lianxin.app" || packageName == "com.lianxin.lxchat" -> "lianxin"
            else -> return
        }

        // 检测新内容并触发处理
        val adapter = when (platform) {
            "soul" -> com.aaiagent.adapter.SoulAdapter(this)
            "qq" -> com.aaiagent.adapter.QQAdapter(this)
            "immomo" -> com.aaiagent.adapter.ImmomoAdapter(this)
            "lianxin" -> com.aaiagent.adapter.LianxinAdapter(this)
            else -> return
        }

        if (adapter.isInChat(root)) {
            val messages = adapter.getUnreadMessages(root)
            for (msg in messages) {
                engine.onNewMessage(platform, msg)
            }
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