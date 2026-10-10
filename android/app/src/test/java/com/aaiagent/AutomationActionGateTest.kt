package com.aaiagent

import com.aaiagent.engine.automation.AutomationActionGate
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomationActionGateTest {
    @Test
    fun `serializes page actions`() = runBlocking {
        val order = mutableListOf<String>()
        val first = async {
            AutomationActionGate.withPermit("first") {
                order += "first-start"
                delay(80)
                order += "first-end"
            }
        }
        delay(10)
        val second = async {
            AutomationActionGate.withPermit("second") {
                order += "second-start"
                order += "second-end"
            }
        }
        first.await()
        second.await()

        assertEquals(listOf("first-start", "first-end", "second-start", "second-end"), order)
    }

    @Test
    fun `returns null when another action keeps the permit too long`() = runBlocking {
        val first = async {
            AutomationActionGate.withPermit("long") {
                delay(200)
                true
            }
        }
        delay(10)
        val blocked = AutomationActionGate.withPermit("short", waitMs = 30) {
            true
        }

        assertNull(blocked)
        assertTrue(first.await() == true)
    }

    @Test
    fun `a long running action is not cancelled after the waiting timeout`() = runBlocking {
        val result = AutomationActionGate.withPermit("long-running", waitMs = 30) {
            delay(120)
            "finished"
        }

        assertEquals("finished", result)
        assertEquals("", AutomationActionGate.currentOwner())
    }
}
