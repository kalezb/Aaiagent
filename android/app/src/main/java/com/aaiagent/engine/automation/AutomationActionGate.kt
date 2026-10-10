package com.aaiagent.engine.automation

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicReference

/**
 * One page-owning automation action at a time.
 *
 * Scanning, sending, returning, watchdog recovery and manual voice tests must not
 * click the same page concurrently.
 */
object AutomationActionGate {
    private val mutex = Mutex()
    private val activeOwner = AtomicReference<String?>(null)

    suspend fun <T> withPermit(
        owner: String,
        waitMs: Long = DEFAULT_WAIT_MS,
        block: suspend () -> T,
    ): T? {
        // waitMs only covers waiting for the page permit. Applying it to the
        // whole block used to cancel a normal read/model/send sequence after
        // 2.5s, leaving the chat page occupied and the current contact
        // unanswered. Once work starts, it owns the page until it finishes or
        // the surrounding hosting lease/coroutine is cancelled.
        val acquired = withTimeoutOrNull(waitMs.coerceAtLeast(1L)) {
            mutex.lock()
            true
        } == true
        if (!acquired) return null

        activeOwner.set(owner)
        return try {
            block()
        } finally {
            activeOwner.compareAndSet(owner, null)
            mutex.unlock()
        }
    }

    fun currentOwner(): String = activeOwner.get().orEmpty()

    private const val DEFAULT_WAIT_MS = 2_500L
}
