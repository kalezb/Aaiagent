package com.aaiagent

import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.screens.PersonaPresentation
import org.junit.Assert.assertEquals
import org.junit.Test

class PersonaPresentationTest {
    @Test
    fun `formats female persona as customer service label`() {
        val persona = PersonaItem(id = "female", name = "星暮", gender = "female")

        assertEquals("女客服 · 星暮", PersonaPresentation.displayName(persona))
    }

    @Test
    fun `formats male persona as customer service label`() {
        val persona = PersonaItem(id = "male_chenyu", name = "陈屿", gender = "male")

        assertEquals("男客服 · 陈屿", PersonaPresentation.displayName(persona))
    }

    @Test
    fun `infers gender from legacy persona id`() {
        val persona = PersonaItem(id = "female_sutang", name = "苏棠")

        assertEquals("女客服 · 苏棠", PersonaPresentation.displayName(persona))
    }
}
