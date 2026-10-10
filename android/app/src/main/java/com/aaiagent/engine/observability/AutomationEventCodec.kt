package com.aaiagent.engine.observability

import com.google.gson.GsonBuilder

object AutomationEventCodec {
    private val gson = GsonBuilder()
        .disableHtmlEscaping()
        .create()

    fun toJson(event: AutomationEvent): String = gson.toJson(event)
}
