package com.aaiagent

import com.aaiagent.data.repository.ContactListCodec
import com.aaiagent.network.ConfigResponse
import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiConfigModelsTest {
    @Test
    fun `parses contact_blacklist from json and normalizes`() {
        val json = """
            {
                "active_persona_id": "female",
                "active_persona_name": "苏棠",
                "contact_blacklist": ["张三", " 李四 ", "张三"]
            }
        """.trimIndent()

        val parsed = Gson().fromJson(json, ConfigResponse::class.java)
        assertEquals(listOf("张三", " 李四 ", "张三"), parsed.contactBlacklist)

        val normalized = ContactListCodec.normalize(parsed.contactBlacklist ?: emptyList())
        assertEquals(listOf("张三", "李四"), normalized)
    }

    @Test
    fun `handles missing contact_blacklist safely`() {
        val json = """
            {
                "active_persona_id": "female",
                "active_persona_name": "苏棠"
            }
        """.trimIndent()

        val parsed = Gson().fromJson(json, ConfigResponse::class.java)
        assertTrue(parsed.contactBlacklist == null)
    }
}
