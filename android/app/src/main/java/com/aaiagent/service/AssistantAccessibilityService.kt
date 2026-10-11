package com.aaiagent.service

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.data.db.AppDatabase
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.engine.EngineState
import com.aaiagent.engine.HostingSessionPolicy
import com.aaiagent.engine.MessageEngine
import com.aaiagent.engine.observability.AccessibilityTreeFingerprint
import com.aaiagent.engine.observability.AccessibilityEventJournal
import com.aaiagent.engine.observability.AutomationPageKind
import com.aaiagent.engine.observability.AutomationTrace
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
    private val pageSampleReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_CAPTURE_PAGE_SAMPLE) return
            serviceScope.launch {
                val result = runCatching { engine.capturePageSample() }.getOrNull()
                val message = if (result == null) {
                    "页面采样失败"
                } else {
                    val upload = if (result.uploaded) "已上传" else "已保存本地"
                    "采样成功 #${result.sequence} ${result.pageKind} $upload"
                }
                Toast.makeText(this@AssistantAccessibilityService, message, Toast.LENGTH_LONG).show()
            }
        }
    }
    private val shadowProbeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_PROBE_SOUL_SHADOW) return
            serviceScope.launch {
                val probed = runCatching { engine.probeSoulShadowNow() }.getOrDefault(false)
                val message = if (probed) {
                    "影子探测完成，请查看运行日志"
                } else {
                    "影子探测跳过：当前不在 Soul 页面"
                }
                Toast.makeText(this@AssistantAccessibilityService, message, Toast.LENGTH_LONG).show()
            }
        }
    }

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
        AccessibilityEventJournal.init(this)
        setSharedEngine(engine)
        ContextCompat.registerReceiver(
            this,
            pageSampleReceiver,
            IntentFilter(ACTION_CAPTURE_PAGE_SAMPLE),
            ContextCompat.RECEIVER_EXPORTED,
        )
        ContextCompat.registerReceiver(
            this,
            shadowProbeReceiver,
            IntentFilter(ACTION_PROBE_SOUL_SHADOW),
            ContextCompat.RECEIVER_EXPORTED,
        )

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
        recordAccessibilityEvent(event)

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

    private fun recordAccessibilityEvent(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString().orEmpty()
        val platform = platformForPackage(packageName).orEmpty()
        val root = rootInActiveWindow
        val adapter = adapterRegistry.get(packageName)
        val observation = if (root != null && adapter != null) {
            adapter.observePage(root)
        } else {
            null
        }
        AccessibilityEventJournal.recordAccessibilityEvent(
            event = event,
            platform = platform,
            pageKind = observation?.kind ?: AutomationPageKind.UNKNOWN,
            contactName = observation?.contactName.orEmpty(),
            engineState = engine.currentState().toString(),
            inChat = adapter != null && root != null && adapter.isInChat(root),
            inMessageList = adapter != null && root != null && adapter.isInMessageList(root),
        )
    }

    private fun handleWindowStateChanged(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val adapter = adapterRegistry.get(packageName) ?: return
        val root = rootInActiveWindow ?: return
        val platform = platformForPackage(packageName) ?: return
        adapter.onWindowStateChanged(event.className?.toString())
        val isInChatRoom = adapter.isInChat(root)
        val observation = adapter.observePage(root)
        val profileName = observation.contactName.takeIf { observation.kind == AutomationPageKind.PROFILE_PAGE }
        val pageKind = observation.kind
        AutomationTrace.recordPageObservation(
            platform = platform,
            contactId = adapter.readChatTitle(root).orEmpty().ifBlank { profileName.orEmpty() },
            pageKind = pageKind,
            source = "window_state",
            engineState = engine.currentState().toString(),
            nodeFingerprint = AccessibilityTreeFingerprint.from(root),
            hostingEnabled = engine.hostingEnabled,
        )
        if (pageKind == AutomationPageKind.PROFILE_PAGE && engine.hostingEnabled) {
            engine.onUnexpectedProfilePage(observation.contactName)
        }
        engine.onPageChanged(isInChatRoom)

        // 2026-10-07 用户指正：他看到的是**真正的个人资料页**（顶部返回+名字、匹配度、展品馆、
        // 底部关注/私聊，**没有聊天输入框**）。按下述真机结构 id 判别，并在窗口变化时立刻报警 ——
        // 这是所有页面变化都会经过的地方，比只在“导航离开”时判断更容易抓到现场。
        profileName?.let {
            android.util.Log.w(
                "AIA",
                "PROFILE-PAGE detected(window) name=" + it +
                    " input=" + root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/et_sendmessage").size +
                    " chatTitle=" + root.findAccessibilityNodeInfosByViewId("cn.soulapp.android:id/tv_title").size
            )
        }
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
        "com.douban.frodo" -> "douban"
        "com.lianxin.app", "com.lianxin.lxchat" -> "lianxin"
        else -> null
    }

    override fun onInterrupt() {
        android.util.Log.d("AIA", "AccessibilityService onInterrupt")
        isEnabled = false
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(pageSampleReceiver) }
        runCatching { unregisterReceiver(shadowProbeReceiver) }
        engine.shutdown()
        AccessibilityEventJournal.shutdown()
        serviceScope.cancel()
        clearSharedEngine(engine)
        super.onDestroy()
    }

    companion object {
        const val ACTION_CAPTURE_PAGE_SAMPLE = "com.aaiagent.CAPTURE_PAGE_SAMPLE"
        const val ACTION_PROBE_SOUL_SHADOW = "com.aaiagent.PROBE_SOUL_SHADOW"

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
