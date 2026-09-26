package com.aaiagent.data.repository

import com.google.gson.Gson

object ContactListCodec {
    private val gson = Gson()

    fun encode(values: List<String>): String = gson.toJson(normalize(values))

    fun decode(raw: String?): List<String> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching {
            gson.fromJson(raw, Array<String>::class.java)?.toList().orEmpty()
        }.getOrElse { emptyList() }.let(::normalize)
    }

    fun normalize(values: List<String>): List<String> {
        return values.map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
    }
}
