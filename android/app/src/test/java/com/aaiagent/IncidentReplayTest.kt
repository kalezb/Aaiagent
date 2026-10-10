package com.aaiagent

import com.aaiagent.adapter.ChatPageStabilityPolicy
import com.aaiagent.adapter.SoulTapPolicy
import com.google.gson.Gson
import com.google.gson.JsonObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IncidentReplayTest {
    private val gson = Gson()

    @Test
    fun `dynamic sticker transient does not leave a confirmed chat`() {
        var lastChatAtMs = 0L
        var stable = false

        for (event in load("dynamic-sticker-transient.jsonl")) {
            val pageKind = event.get("pageKind")?.asString.orEmpty()
            val nowMs = event.get("timestampMs")?.asLong ?: 0L
            stable = ChatPageStabilityPolicy.shouldTreatAsChat(
                chatDetected = pageKind == "VERIFIED_CHAT",
                explicitNonChat = pageKind == "CONVERSATION_LIST" ||
                    pageKind == "PROFILE_PAGE" ||
                    pageKind == "COMMERCE",
                lastChatAtMs = lastChatAtMs,
                nowMs = nowMs,
            )
            if (stable) lastChatAtMs = nowMs
        }

        assertTrue(stable)
    }

    @Test
    fun `stale send button cannot click the profile tab`() {
        val event = load("stale-send-button.jsonl").single()
        val actualViewId = event.get("reason")?.asString
        assertFalse(
            SoulTapPolicy.matchesViewId(
                actualViewId = actualViewId,
                expectedViewId = "btn_send",
                prefix = "cn.soulapp.android:id/",
            )
        )
    }

    private fun load(name: String): List<JsonObject> {
        val text = javaClass.classLoader
            ?.getResourceAsStream("incident-replay/$name")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: error("missing replay fixture: $name")
        return text.lineSequence()
            .map(String::trim)
            .filter(String::isNotEmpty)
            .map { gson.fromJson(it, JsonObject::class.java) }
            .toList()
    }
}
