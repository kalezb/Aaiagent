package com.aaiagent.ui.screens

object PersonaPresentation {
    fun genderLabel(persona: PersonaItem): String {
        val gender = persona.gender.ifBlank {
            if (persona.id.startsWith("female")) "female" else "male"
        }
        return if (gender == "female") "女客服" else "男客服"
    }

    fun displayName(persona: PersonaItem): String =
        "${genderLabel(persona)} · ${persona.name}"
}
