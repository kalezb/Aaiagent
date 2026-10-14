package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository
import com.aaiagent.network.ApiService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

internal class ReplyTaskReporter(
    private val scope: CoroutineScope,
    private val activeToken: suspend () -> String?,
    private val sendReport: suspend (
        token: String,
        taskId: String,
        status: String,
        error: String,
    ) -> Unit,
) {
    constructor(
        repository: AppRepository,
        scope: CoroutineScope,
    ) : this(
        scope = scope,
        activeToken = { repository.getActiveToken()?.token },
        sendReport = { token, taskId, status, error ->
            ApiService(repository.getApiBaseUrl())
                .reportReplyTask(token, taskId, status, error)
        },
    )

    fun report(taskId: String?, status: String, error: String) {
        if (taskId.isNullOrBlank()) return
        scope.launch(Dispatchers.IO) {
            try {
                val token = activeToken()?.trim().orEmpty()
                if (token.isEmpty()) return@launch
                sendReport(token, taskId, status, error)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                runCatching {
                    android.util.Log.w(
                        "AIA",
                        "reply task report failed: ${error.message}",
                        error,
                    )
                }
            }
        }
    }
}
