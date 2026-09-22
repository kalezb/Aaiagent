package com.aaiagent.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.MessageEngine

class NotificationListener : NotificationListenerService() {

    private lateinit var engine: MessageEngine
    private lateinit var repository: AppRepository
    var isEnabled = false
        private set

    override fun onCreate() {
        super.onCreate()
        val db = AppDatabase.getInstance(this)
        repository = AppRepository(db)
        engine = MessageEngine(null, repository)
    }

    override fun onListenerConnected() {
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
            "com.soulapp.cn" -> "soul"
            "com.tencent.mobileqq" -> "qq"
            "com.immomo.momo" -> "immomo"
            "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
            else -> return
        }

        if (text.isNotEmpty()) {
            val msg = com.aaiagent.adapter.PlatformAdapter.MessageInfo(
                id = "notif_${text.hashCode()}_${System.currentTimeMillis()}",
                content = text,
                sender = title
            )
            engine.onNewMessage(platform, msg)
        }
    }
}
