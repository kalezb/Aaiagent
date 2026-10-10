package com.aaiagent

import com.aaiagent.engine.observability.AutomationEvent
import com.aaiagent.engine.observability.AutomationIncidentExporter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AutomationIncidentExporterTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `exports the complete incident timeline`() {
        val directory = temporaryFolder.newFolder("journal")
        val exporter = AutomationIncidentExporter(directory)
        val events = listOf(
            AutomationEvent(eventId = "event-1", incidentId = "inc-1"),
            AutomationEvent(eventId = "event-2", incidentId = "inc-1"),
        )

        val exported = exporter.export("inc-1", events)

        assertTrue(exported?.exists() == true)
        assertEquals(2, exported?.readLines()?.size)
        assertTrue(exported?.readText().orEmpty().contains("\"event-1\""))
    }
}
