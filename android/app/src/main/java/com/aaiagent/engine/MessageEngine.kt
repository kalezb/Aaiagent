package com.aaiagent.engine

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.*
import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.network.ChatRequest
import kotlinx.coroutines.*
import java.util.Random

enum class EngineState {
    IDLE,
    LISTENING,
    READING,
    CALLING_API,
    PASTING,
    SENDING,
    INTERRUPTED
}

class MessageEngine(
    private val service: AccessibilityService,
    private val repository: AppRepository
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var state = EngineState.IDLE
    private var currentPlatform: String? = null
    private var pendingMessages = mutableListOf<PlatformAdapter.MessageInfo>()
    private var job: Job? = null
    private val random = Random()

    private val adapters = mapOf(
        "soul" to SoulAdapter(service),
        "qq" to QQAdapter(service),
        "immomo" to ImmomoAdapter(service),
        "lianxin" to LianxinAdapter(service)
    )

    // 参数常量（写死）
    companion object {
        const val SHORT_WINDOW_MS = 500L
        const val MAX_RECALC = 3
        const val MAX_WAIT_MS = 8000L
        const val DEDUP_WINDOW_MS = 5 * 60 * 1000L
        const val SINGLE_TIMEOUT_S = 150L
        const val TEMPERATURE = 0.7
        const val MAX_TOKENS = 300
        const val DELAY_MIN_MS = 500L
        const val DELAY_MAX_MS = 1500L
        const val PRE_SEND_CHECK_MS = 100L
        const val POLL_INTERVAL_MS = 30_000L
        const val NOTIFICATION_FAIL_THRESHOLD = 10
    }

    private var notificationFailCount = 0

    fun onNewMessage(platform: String, message: PlatformAdapter.MessageInfo) {
        if (state == EngineState.INTERRUPTED) return

        // 去重检查
        if (repository.isDuplicate(message.id)) return

        when (state) {
            EngineState.IDLE -> {
                currentPlatform = platform
                pendingMessages.clear()
                pendingMessages.add(message)
                repository.cacheMessage(message.id, platform, "", "", message.content)
                state = EngineState.LISTENING
                startShortWindow()
            }
            EngineState.LISTENING -> {
                pendingMessages.add(message)
                repository.cacheMessage(message.id, platform, "", "", message.content)
            }
            EngineState.CALLING_API -> {
                // LLM 期间新消息来就作废旧回复重算
                if (pendingMessages.size < MAX_RECALC * 3) {
                    pendingMessages.add(message)
                    repository.cacheMessage(message.id, platform, "", "", message.content)
                    job?.cancel()
                    startProcessing()
                }
            }
            else -> {
                // 正在发送中，忽略
            }
        }
    }

    fun onUserInteraction() {
        if (state == EngineState.PASTING || state == EngineState.SENDING) {
            state = EngineState.INTERRUPTED
            clearInputField()
        }
    }

    private fun startShortWindow() {
        job?.cancel()
        job = scope.launch {
            delay(SHORT_WINDOW_MS)
            if (state == EngineState.LISTENING) {
                startProcessing()
            }
        }

        // 最大等待超时
        scope.launch {
            delay(MAX_WAIT_MS)
            if (state == EngineState.LISTENING) {
                job?.cancel()
                startProcessing()
            }
        }
    }

    private fun startProcessing() {
        job?.cancel()
        job = scope.launch {
            processMessages()
        }
    }

    private suspend fun processMessages() {
        val platform = currentPlatform ?: return
        val adapter = adapters[platform] ?: return

        state = EngineState.READING

        try {
            // 获取 root
            val root = service.rootInActiveWindow ?: run {
                state = EngineState.IDLE
                return
            }

            // 检查是否在聊天页
            if (!adapter.isInChat(root)) {
                // 需要先打开聊天
                if (!openChatFromMessageList(adapter, root)) {
                    state = EngineState.IDLE
                    return
                }
            }

            delay(randomDelay())

            // 检查用户是否在操作
            if (isUserTouching()) {
                state = EngineState.INTERRUPTED
                return
            }

            val root2 = service.rootInActiveWindow ?: run {
                state = EngineState.IDLE
                return
            }

            // 读取联系人信息
            val contactId = adapter.getContactId(root2) ?: "unknown"
            val contactName = adapter.getContactName(root2) ?: contactId

            // 获取未读消息
            val unreadMessages = adapter.getUnreadMessages(root2)
            val allMessages = (pendingMessages + unreadMessages).distinctBy { it.id }
            val combinedMessage = allMessages.joinToString("\n") { it.content }

            state = EngineState.CALLING_API

            // 调云端
            val token = repository.getActiveToken()?.token ?: ""
            val apiService = ApiService(repository.getApiBaseUrl())
            val personaId = repository.getPersonaId()

            var recalcCount = 0
            var reply: String? = null

            while (recalcCount < MAX_RECALC) {
                try {
                    val response = apiService.chat(
                        ChatRequest(
                            token = token,
                            platform = platform,
                            contactId = contactId,
                            contactName = contactName,
                            message = combinedMessage,
                            messageId = allMessages.firstOrNull()?.id ?: "",
                            personaId = personaId
                        )
                    )

                    if (response.skipped == true) {
                        state = EngineState.IDLE
                        return
                    }

                    if (response.error != null) {
                        recalcCount++
                        delay(1000)
                        continue
                    }

                    reply = response.reply
                    break
                } catch (e: Exception) {
                    recalcCount++
                    if (recalcCount >= MAX_RECALC) {
                        reply = "嗯嗯"
                    }
                    delay(1000)
                }
            }

            if (reply == null) reply = "嗯嗯，好的。"

            // 粘贴发送
            state = EngineState.PASTING

            // 发送前100ms检查用户是否碰屏幕
            delay(PRE_SEND_CHECK_MS)
            if (isUserTouching()) {
                state = EngineState.INTERRUPTED
                clearInputField()
                return
            }

            val root3 = service.rootInActiveWindow ?: run {
                state = EngineState.IDLE
                return
            }

            val inputField = adapter.getInputField(root3) ?: run {
                state = EngineState.IDLE
                return
            }

            // 粘贴回复
            inputField.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            delay(randomDelay())

            val arguments = Bundle()
            arguments.putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                reply
            )
            inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
            delay(randomDelay())

            // 点击发送
            state = EngineState.SENDING
            val sendButton = adapter.getSendButton(root3)
            if (sendButton != null) {
                sendButton.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                delay(randomDelay())
            }

            // 返回消息列表
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(randomDelay())

        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            state = EngineState.IDLE
            pendingMessages.clear()
            repository.cleanOldCache()
        }
    }

    private fun openChatFromMessageList(adapter: PlatformAdapter, root: AccessibilityNodeInfo): Boolean {
        val root2 = service.rootInActiveWindow ?: return false
        if (!adapter.isInMessageList(root2)) return false

        // 找第一个未读会话
        val success = adapter.openChat(null, root2)
        if (success) {
            delaySync(1000)
            return true
        }
        return false
    }

    private fun isUserTouching(): Boolean {
        return try {
            // 通过检查当前焦点判断用户是否在操作
            val root = service.rootInActiveWindow ?: return false
            val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            focused != null
        } catch (e: Exception) {
            false
        }
    }

    private fun clearInputField() {
        try {
            val root = service.rootInActiveWindow ?: return
            val adapter = adapters[currentPlatform] ?: return
            val inputField = adapter.getInputField(root) ?: return
            val args = Bundle()
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            inputField.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } catch (_: Exception) {}
    }

    private fun randomDelay(): Long = DELAY_MIN_MS + random.nextLong(DELAY_MAX_MS - DELAY_MIN_MS)
    private fun delaySync(ms: Long) = Thread.sleep(ms)

    fun getState(): EngineState = state
    fun shutdown() { scope.cancel() }
}