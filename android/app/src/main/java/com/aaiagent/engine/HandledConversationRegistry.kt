package com.aaiagent.engine

internal class HandledConversationRegistry(
    private val currentPlatform: () -> String,
) {
    private val handledIds = mutableSetOf<String>()

    @Synchronized
    fun clear() {
        handledIds.clear()
    }

    @Synchronized
    fun mark(contactId: String) {
        if (contactId.isBlank()) return
        handledIds.add(key(contactId))
    }

    @Synchronized
    fun contains(contactId: String): Boolean {
        return contactId.isNotBlank() && key(contactId) in handledIds
    }

    private fun key(contactId: String): String = "${currentPlatform()}:$contactId"
}
