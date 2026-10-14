package com.aaiagent.engine

import com.aaiagent.network.ApiService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

internal class ContactSyncScheduler(
    private val scope: CoroutineScope,
    private val currentPlatform: () -> String,
    private val registerContact: suspend (
        api: ApiService,
        token: String,
        platform: String,
        contactId: String,
        contactName: String,
    ) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val lastSyncedAtByKey = mutableMapOf<String, Long>()

    fun schedule(
        api: ApiService,
        token: String,
        contactId: String,
        contactName: String,
    ) {
        val key = "${currentPlatform()}:$contactId"
        val nowMs = now()
        synchronized(lastSyncedAtByKey) {
            val lastSyncedAt = lastSyncedAtByKey[key] ?: 0L
            if (nowMs - lastSyncedAt < CONTACT_SYNC_THROTTLE_MS) return
            lastSyncedAtByKey[key] = nowMs
        }
        scope.launch(Dispatchers.IO) {
            runCatching {
                registerContact(
                    api,
                    token,
                    currentPlatform(),
                    contactId,
                    contactName,
                )
            }
                .onSuccess {
                    runCatching {
                        android.util.Log.d("AIA", "contact sync result=$it contact=$contactName")
                    }
                }
                .onFailure { error ->
                    runCatching {
                        android.util.Log.w(
                            "AIA",
                            "contact sync failed: ${error.message}",
                            error,
                        )
                    }
                }
        }
    }

    private companion object {
        const val CONTACT_SYNC_THROTTLE_MS = 15 * 60 * 1000L
    }
}
