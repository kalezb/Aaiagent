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

    fun name(persona: PersonaItem): String = persona.name.trim().ifBlank { "未命名客服" }

    fun avatarLabel(persona: PersonaItem): String = name(persona).take(1)

    fun roleDetail(persona: PersonaItem): String = when (genderLabel(persona)) {
        "女客服" -> "自然亲切"
        else -> "直接稳重"
    }
}
