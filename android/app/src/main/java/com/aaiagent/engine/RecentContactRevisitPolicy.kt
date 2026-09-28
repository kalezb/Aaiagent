package com.aaiagent.engine


/**
 * Remembers a contact briefly after an automated reply. Opening a chat can
 * clear the platform's unread badge, so the normal unread-only scan is not
 * enough to catch a new message that arrives immediately after a reply.
 */
object RecentContactRevisitPolicy {
    const val TTL_MS = 30_000L
    const val DELAY_MS = 1_200L
    const val MAX_ATTEMPTS = 2

    data class Visit(
        val platform: String,
        val contactId: String,
        val contactName: String,
        val dueAt: Long,
        val expiresAt: Long,
        val attempts: Int = 0,
    )

    fun schedule(
        platform: String,
        contactId: String,
        contactName: String,
        now: Long,
    ): Visit {
        return Visit(
            platform = platform,
            contactId = contactId,
            contactName = contactName,
            dueAt = now + DELAY_MS,
            expiresAt = now + TTL_MS,
        )
    }

    fun findDue(visits: Collection<Visit>, platform: String, now: Long): Visit? {
        return visits
            .asSequence()
            .filter { it.platform == platform && it.expiresAt > now && it.dueAt <= now }
            .minByOrNull { it.dueAt }
    }

    fun retainActive(visits: Collection<Visit>, now: Long): List<Visit> {
        return visits.filter { it.expiresAt > now && it.attempts < MAX_ATTEMPTS }
    }

    fun afterAttempt(visit: Visit, now: Long): Visit? {
        val attempts = visit.attempts + 1
        if (attempts >= MAX_ATTEMPTS || visit.expiresAt <= now) return null
        return visit.copy(attempts = attempts, dueAt = now + DELAY_MS)
    }

    fun matches(visit: Visit, contactName: String?): Boolean {
        return ConversationIdentity.matches(visit.contactName, contactName)
    }
}
