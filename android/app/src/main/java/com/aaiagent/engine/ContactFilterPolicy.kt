package com.aaiagent.engine

/**
 * Contact allow/deny policy used before any automated chat is processed.
 * Blacklist always wins. An empty whitelist means all non-blacklisted contacts.
 */
object ContactFilterPolicy {
    fun allowsContact(
        contactName: String?,
        contactId: String?,
        whitelist: List<String>,
        blacklist: List<String>
    ): Boolean {
        val aliases = listOfNotNull(contactName, contactId)
            .map(::normalize)
            .filter { it.isNotEmpty() }
            .distinct()

        if (blacklist.any { entry -> aliases.any { matches(entry, it) } }) return false
        if (whitelist.isEmpty()) return true
        return whitelist.any { entry -> aliases.any { matches(entry, it) } }
    }

    fun matches(entry: String, value: String): Boolean {
        val expected = normalize(entry)
        val actual = normalize(value)
        if (expected.isEmpty() || actual.isEmpty()) return false
        if (expected == actual) return true
        if (ConversationIdentity.matches(expected, actual)) return true

        if (expected.length < 2 || actual.length < 2) return false
        return actual.contains(expected) || expected.contains(actual)
    }

    private fun normalize(value: String?): String {
        if (value.isNullOrBlank()) return ""
        return ConversationIdentity.normalize(value)
            .trimEnd('.', '。', '…')
            .lowercase()
            .trim()
    }
}
