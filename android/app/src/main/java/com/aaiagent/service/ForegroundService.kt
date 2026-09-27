package com.aaiagent.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.aaiagent.MainActivity
import com.aaiagent.R
import com.aaiagent.ui.components.FloatingWindow
import com.aaiagent.ui.components.FloatingWindowStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class ForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "aaiagent_foreground"
        const val NOTIFICATION_ID = 1001

        @Volatile
        var isRunning = false
            private set

        fun ensureRunning(context: Context) {
            val intent = Intent(context, ForegroundService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var floatingWindow: FloatingWindow? = null
    private var lastHostingState: Boolean? = null
    private var toggleInFlight = false

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        serviceScope.launch {
            while (isActive) {
                syncFloatingWindow()
                delay(750)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification(currentHosting()))
        syncFloatingWindow()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        floatingWindow?.hide()
        floatingWindow = null
        serviceScope.cancel()
        isRunning = false
        super.onDestroy()
    }

    private fun syncFloatingWindow() {
        if (!Settings.canDrawOverlays(this)) {
            floatingWindow?.hide()
            floatingWindow = null
            lastHostingState = null
            return
        }

        val hosting = currentHosting()
        if (floatingWindow?.isShowing() != true) {
            floatingWindow = FloatingWindow(this).also { window ->
                if (!window.show(
                        hosting = hosting,
                        toggleListener = ::requestHostingToggle,
                        longClickListener = ::openMainActivity
                    )
                ) {
                    floatingWindow = null
                    return
                }
                lastHostingState = hosting
            }
        }

        if (!toggleInFlight && lastHostingState != hosting) {
            floatingWindow?.updateStatus(if (hosting) FloatingWindowStatus.ON else FloatingWindowStatus.OFF)
            lastHostingState = hosting
            updateNotification(hosting)
        }
    }

    private fun requestHostingToggle(enable: Boolean) {
        if (toggleInFlight) return
        toggleInFlight = true
        floatingWindow?.updateStatus(
            if (enable) FloatingWindowStatus.BUSY_ON else FloatingWindowStatus.BUSY_OFF
        )
        serviceScope.launch {
            val result = HostingController.setHosting(
                context = this@ForegroundService,
                enable = enable
            )
            lastHostingState = result.enabled
            floatingWindow?.updateStatus(
                if (result.enabled) FloatingWindowStatus.ON else FloatingWindowStatus.OFF
            )
            updateNotification(result.enabled)
            if (!result.success) {
                Toast.makeText(this@ForegroundService, result.message, Toast.LENGTH_SHORT).show()
            }
            toggleInFlight = false
        }
    }

    private fun currentHosting(): Boolean =
        AssistantAccessibilityService.sharedEngine?.hostingEnabled == true

    private fun openMainActivity() {
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            }
        )
    }

    private fun updateNotification(hosting: Boolean) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(hosting))
    }

    private fun buildNotification(hosting: Boolean): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI托管助手")
            .setContentText(if (hosting) "AI托管运行中" else "悬浮控制已就绪")
            .setSmallIcon(R.drawable.ic_floating_power)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AI托管服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "AI托管助手前台服务"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
