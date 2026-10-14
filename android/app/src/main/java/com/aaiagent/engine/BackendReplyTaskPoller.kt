package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import com.aaiagent.network.ReplyTask
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentLinkedQueue

internal class BackendReplyTaskPoller(
    private val scope: CoroutineScope,
    private val activeToken: suspend () -> String?,
    private val currentPlatform: () -> String,
    private val canAcceptTask: (leaseToken: String) -> Boolean,
    private val fetchTask: suspend (token: String, platform: String) -> ReplyTask?,
    private val now: () -> Long = System::currentTimeMillis,
) {
    constructor(
        repository: AppRepository,
        scope: CoroutineScope,
        currentPlatform: () -> String,
        canAcceptTask: (leaseToken: String) -> Boolean,
    ) : this(
        scope = scope,
        activeToken = { repository.getActiveToken()?.token },
        currentPlatform = currentPlatform,
        canAcceptTask = canAcceptTask,
        fetchTask = { token, platform ->
            ApiService(repository.getApiBaseUrl()).getNextReplyTask(token, platform)
        },
    )

    private val pendingTasks = ConcurrentLinkedQueue<ReplyTask>()
    private var pollJob: Job? = null
    private var lastPollAt: Long = 0L

    fun nextTask(): ReplyTask? = pendingTasks.poll()

    fun clear() {
        pollJob?.cancel()
        pollJob = null
        pendingTasks.clear()
    }

    fun schedule(leaseToken: String) {
        if (pollJob?.isActive == true || !pendingTasks.isEmpty()) return
        val nowMs = now()
        if (!BackendTaskPollPolicy.isDue(lastPollAt, nowMs, BACKEND_TASK_POLL_INTERVAL_MS)) return
        lastPollAt = nowMs
        pollJob = scope.launch(Dispatchers.IO) {
            val startedAt = System.currentTimeMillis()
            try {
                val token = activeToken()?.trim().orEmpty()
                if (token.isEmpty()) return@launch
                val task = fetchTask(token, currentPlatform())
                if (task != null && canAcceptTask(leaseToken)) {
                    pendingTasks.add(task)
                }
                runCatching {
                    android.util.Log.d(
                        "AIA",
                        "backend reply task poll complete task=${task != null} " +
                            "elapsed=${System.currentTimeMillis() - startedAt}",
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: InterruptedIOException) {
                runCatching {
                    android.util.Log.w("AIA", "backend reply task poll timed out: ${error.message}")
                }
                RuntimeJournal.recovery("调用回复接口超时，等待下一轮扫描: ${error.message}")
                return@launch
            } catch (error: Exception) {
                runCatching {
                    android.util.Log.w(
                        "AIA",
                        "backend reply task poll failed " +
                            "elapsed=${System.currentTimeMillis() - startedAt}: ${error.message}",
                        error,
                    )
                }
            }
        }
    }

    private companion object {
        const val BACKEND_TASK_POLL_INTERVAL_MS = 30_000L
    }
}
