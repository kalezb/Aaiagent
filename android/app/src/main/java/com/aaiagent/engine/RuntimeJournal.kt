package com.aaiagent.engine

import com.aaiagent.engine.observability.AutomationTrace
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

/**
 * 运行日志 (补充页 §三)
 * 每一步操作都记, 保留最近7天, 自动删旧
 */
object RuntimeJournal {
    private const val MAX_AGE_DAYS = 7
    private const val MAX_JSONL_BYTES = 16L * 1024L * 1024L
    private var logFile: File? = null
    private var jsonlFile: File? = null
    private val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.getDefault())

    fun init(logDir: File, appVersion: String = "") {
        logDir.mkdirs()
        logFile = File(logDir, "runtime_journal.txt")
        jsonlFile = File(logDir, "runtime_journal.jsonl")
        AutomationTrace.init(logDir, appVersion)
        cleanOldLogs()
    }

    fun log(step: String, result: String, detail: String = "") {
        val f = logFile ?: return
        val ts = fmt.format(Date())
        val line = "[$ts] $step | $result${if (detail.isNotEmpty()) " | $detail" else ""}"
        try {
            f.appendText(line + "\n")
        } catch (_: Exception) {}
    }

    // ---- 必须记录的操作 ----
    fun notifyReceived(platform: String, contactName: String, content: String) {
        log("收到通知", "来源=$platform", "联系人=$contactName 内容=${content.take(50)}")
    }

    fun clickConversation(contactName: String, success: Boolean) {
        log("点进会话", if (success) "成功" else "失败", "联系人=$contactName")
    }

    fun readMessages(count: Int, lastMsg: String) {
        log("读消息", "读到${count}条", "最后一条=${lastMsg.take(30)}")
    }

    fun llmCalled(promptPreview: String, reply: String) {
        log("调LLM", "回复=${reply.take(50)}", "prompt预览=${promptPreview.take(50)}")
    }

    fun messageSent(success: Boolean, reason: String = "") {
        log("发消息", if (success) "成功" else "失败", reason)
    }

    fun messageVerified(success: Boolean, detail: String = "") {
        log("发送验证", if (success) "已看到" else "未确认", detail)
    }

    fun replyDecision(source: String, reason: String, overrides: List<String>) {
        val detail = "来源=${source.ifBlank { "unknown" }} 原因=${reason.ifBlank { "-" }}" +
            if (overrides.isEmpty()) "" else " 覆盖=${overrides.joinToString(",")}"
        log("回复决策", detail, "")
    }

    fun wrongPage(pageDesc: String) {
        log("点错页面", "进入未知页面", pageDesc)
    }

    fun recovery(action: String) {
        log("错误恢复", action)
    }

    fun stateChange(from: String, to: String) {
        log("状态变化", "$from → $to")
    }

    fun trace(event: TraceEvent) {
        val f = jsonlFile ?: return
        rotateJsonlIfNeeded(f)
        try {
            f.appendText(TraceEventCodec.toJsonLine(event) + "\n")
        } catch (_: Exception) {
        }
        AutomationTrace.recordLegacyTrace(event)
    }

    // 读取最近N条
    fun recent(count: Int): List<String> {
        val f = logFile ?: return emptyList()
        return try {
            f.readLines().takeLast(count)
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun cleanOldLogs() {
        val f = logFile ?: return
        if (!f.exists()) return
        val cutoff = System.currentTimeMillis() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000L
        if (f.lastModified() < cutoff) {
            f.delete()
        }
    }

    private fun rotateJsonlIfNeeded(file: File) {
        if (!file.exists() || file.length() < MAX_JSONL_BYTES) return
        val previous = File(file.parentFile, file.name + ".1")
        if (previous.exists()) previous.delete()
        file.renameTo(previous)
    }
}
