package com.aaiagent

import com.aaiagent.network.ApiService
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ApiServicePersonaFactsTest {
    @Test
    fun `config exposes resolved persona facts`() = runBlocking {
        val server = MockWebServer()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .addHeader("Content-Type", "application/json")
                    .setBody(
                        """
                        {
                          "active_persona_id": "female",
                          "active_persona_name": "星暮",
                          "persona_facts": {
                            "age_mode": "fixed_age",
                            "fixed_age": 29,
                            "birth_year": null,
                            "age": 29,
                            "marital_status": "married",
                            "has_children": false,
                            "children_age": null,
                            "hometown": "重庆",
                            "current_city": "重庆",
                            "current_district": "两江新区",
                            "common_area": "",
                            "work_city": "重庆",
                            "work_district": "江北区",
                            "location_precision": "district",
                            "proactive_location_allowed": false,
                            "contact_qq": "22345678",
                            "config_version": 12
                          }
                        }
                        """.trimIndent()
                    )
            )
            server.start()

            val config = ApiService(server.url("/").toString().trimEnd('/')).getConfig("token")
            val facts = config.personaFacts

            assertEquals("fixed_age", facts?.ageMode)
            assertEquals(29, facts?.fixedAge)
            assertEquals("married", facts?.maritalStatus)
            assertFalse(facts?.hasChildren ?: true)
            assertEquals("两江新区", facts?.currentDistrict)
            assertEquals("district", facts?.locationPrecision)
            assertEquals("22345678", facts?.contactQq)
            assertEquals(12L, facts?.configVersion)
        } finally {
            server.shutdown()
        }
    }

}
