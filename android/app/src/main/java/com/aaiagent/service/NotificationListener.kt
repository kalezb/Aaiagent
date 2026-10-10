package com.aaiagent.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class NotificationListener : NotificationListenerService() {

    var isEnabled = false
        private set

    override fun onCreate() {
        Log.d("AIA", "NotificationListener onCreate")
        super.onCreate()
    }

    override fun onListenerConnected() {
        Log.d("AIA", "NotificationListener connected")
        super.onListenerConnected()
        isEnabled = true
    }

    override fun onListenerDisconnected() {
        isEnabled = false
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null || !isEnabled) return

        val packageName = sbn.packageName
        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getString(Notification.EXTRA_TEXT) ?: ""

        val platform = when (packageName) {
            "cn.soulapp.android" -> "soul"
            "com.tencent.mobileqq" -> "qq"
            "com.immomo.momo" -> "immomo"
            "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
            else -> return
        }

        Log.d("AIA", "Notification: platform=$platform title=$title text=${text.take(50)}")

        if (text.isEmpty()) return

        // Forward to the shared engine via the AccessibilityService
        val engine = AssistantAccessibilityService.sharedEngine
        if (engine != null) {
            val msg = com.aaiagent.adapter.PlatformAdapter.MessageInfo(
                id = "notif_${text.hashCode()}_${System.currentTimeMillis()}",
                content = text,
                sender = title.ifEmpty { "unknown" }
            )
            engine.onNewMessage(platform, msg)
        } else {
            Log.d("AIA", "NotificationListener: engine not available, skipping")
        }
    }
}
