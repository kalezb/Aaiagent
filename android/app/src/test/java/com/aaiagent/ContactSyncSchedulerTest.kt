package com.aaiagent

import com.aaiagent.engine.ContactSyncScheduler
import com.aaiagent.network.ApiService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class ContactSyncSchedulerTest {
    @Test
    fun `same contact is not registered again inside the throttle window`() = runBlocking {
        var now = 1_000_000_000L
        val calls = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val scheduler = ContactSyncScheduler(
            scope = scope,
            currentPlatform = { "soul" },
            registerContact = { _, _, _, _, _ -> calls.incrementAndGet() },
            now = { now },
        )

        try {
            val api = ApiService("http://127.0.0.1")
            scheduler.schedule(api, "token-1", "contact-1", "梦想")
            scheduler.schedule(api, "token-1", "contact-1", "梦想")
            withTimeout(2_000) {
                while (calls.get() == 0) delay(10)
            }
            delay(50)
            assertEquals(1, calls.get())
        } finally {
            scope.cancel()
        }
    }

    @Test
    fun `same contact can be registered after the throttle window`() = runBlocking {
        var now = 1_000_000_000L
        val calls = AtomicInteger(0)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val scheduler = ContactSyncScheduler(
            scope = scope,
            currentPlatform = { "soul" },
            registerContact = { _, _, _, _, _ -> calls.incrementAndGet() },
            now = { now },
        )

        try {
            val api = ApiService("http://127.0.0.1")
            scheduler.schedule(api, "token-1", "contact-1", "梦想")
            withTimeout(2_000) {
                while (calls.get() < 1) delay(10)
            }
            now += 15 * 60 * 1000L
            scheduler.schedule(api, "token-1", "contact-1", "梦想")
            withTimeout(2_000) {
                while (calls.get() < 2) delay(10)
            }
            assertEquals(2, calls.get())
        } finally {
            scope.cancel()
        }
    }
}
