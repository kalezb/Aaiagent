package com.aaiagent.ui.screens

data class PermissionStatus(
    val accessibility: Boolean = false,
    val notification: Boolean = false,
    val batteryOptimization: Boolean = false,
    val overlay: Boolean = false
)

data class PersonaItem(
    val id: String,
    val name: String,
    val systemPrompt: String = "",
    val gender: String = "",
    val isActive: Boolean = false
)

data class PersonaFactsUiState(
    val ageMode: String = "fixed_age",
    val fixedAge: String = "29",
    val birthYear: String = "",
    val maritalStatus: String = "married",
    val hasChildren: Boolean = false,
    val childrenAge: String = "",
    val contactQq: String = "",
    val hometown: String = "重庆",
    val currentCity: String = "重庆",
    val currentDistrict: String = "两江新区",
    val commonArea: String = "",
    val workCity: String = "重庆",
    val workDistrict: String = "江北区",
    val locationPrecision: String = "district",
    val proactiveLocationAllowed: Boolean = false,
    val configVersion: Long = 0L
)
