package com.aaiagent.engine

import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal suspend fun <T> withAutomationLeaseHeartbeat(
    lease: AutomationLease,
    leaseToken: String,
    isEnabled: () -> Boolean,
    intervalMs: Long,
    block: suspend () -> T,
): T = coroutineScope {
    require(intervalMs > 0L)
    // The hosting loop runs on Dispatchers.Main. A long accessibility scan can
    // occupy that thread, so renew the lease from a background dispatcher.
    val heartbeat = launch(Dispatchers.Default) {
        while (isActive && isEnabled()) {
            delay(intervalMs)
            if (!lease.renew(leaseToken)) break
        }
    }
    try {
        block()
    } finally {
        heartbeat.cancel()
    }
}
