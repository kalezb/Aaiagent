package com.aaiagent.network

import com.google.gson.annotations.SerializedName

data class ConfigResponse(
    @SerializedName("active_persona_id") val activePersonaId: String?,
    @SerializedName("active_persona_name") val activePersonaName: String?,
    val location: ConfigLocation? = null,
    @SerializedName("persona_facts") val personaFacts: ConfigPersonaFacts? = null,
    val platform: String? = null,
    @SerializedName("hosting_enabled") val hostingEnabled: Boolean? = null,
    @SerializedName("monitor_enabled") val monitorEnabled: Boolean? = null,
    @SerializedName("weather_enabled") val weatherEnabled: Boolean? = null,
    @SerializedName("time_enabled") val timeEnabled: Boolean? = null,
    @SerializedName("reply_pace_sec") val replyPaceSec: Int? = null,
    @SerializedName("ai_hours_enabled") val aiHoursEnabled: Boolean? = null,
    @SerializedName("ai_start_hour") val aiStartHour: Int? = null,
    @SerializedName("ai_end_hour") val aiEndHour: Int? = null,
    val line: String? = null
)

data class ModelRouteHealthResponse(
    val ok: Boolean = false,
    val line: String? = null,
    val provider: String? = null,
    val error: String? = null,
    @SerializedName("latency_ms") val latencyMs: Long? = null,
    @SerializedName("upstream_status") val upstreamStatus: Int? = null
)

data class ConfigPersonaFacts(
    @SerializedName("age_mode") val ageMode: String? = null,
    @SerializedName("fixed_age") val fixedAge: Int? = null,
    @SerializedName("birth_year") val birthYear: Int? = null,
    val age: Int? = null,
    @SerializedName("marital_status") val maritalStatus: String? = null,
    @SerializedName("has_children") val hasChildren: Boolean? = null,
    @SerializedName("children_age") val childrenAge: Int? = null,
    val hometown: String? = null,
    @SerializedName("current_city") val currentCity: String? = null,
    @SerializedName("current_district") val currentDistrict: String? = null,
    @SerializedName("common_area") val commonArea: String? = null,
    @SerializedName("work_city") val workCity: String? = null,
    @SerializedName("work_district") val workDistrict: String? = null,
    @SerializedName("location_precision") val locationPrecision: String? = null,
    @SerializedName("proactive_location_allowed") val proactiveLocationAllowed: Boolean? = null,
    @SerializedName("contact_qq") val contactQq: String? = null,
    @SerializedName("config_version") val configVersion: Long? = null
)

data class ConfigLocation(
    val home: ConfigAddress? = null,
    val work: ConfigAddress? = null
)

data class ConfigAddress(
    val city: String? = null,
    val district: String? = null
)

data class SyncMessagesRequest(
    val platform: String,
    @SerializedName("contact_id") val contactId: String,
    @SerializedName("contact_name") val contactName: String,
    val messages: List<Map<String, Any>>
)

data class ConfigSaveResult(
    val success: Boolean,
    val message: String,
    val error: String?,
    @SerializedName("config_version") val configVersion: Long? = null,
    @SerializedName("persona_facts") val personaFacts: ConfigPersonaFacts? = null
)
