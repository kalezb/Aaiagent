package com.aaiagent.engine

import com.aaiagent.data.repository.AppRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class ContactAccessGuard(
    private val cooldown: ContactCooldownGuard,
    private val loadFilters: suspend () -> Pair<List<String>, List<String>>,
) {
    constructor(
        repository: AppRepository,
        cooldown: ContactCooldownGuard,
    ) : this(
        cooldown = cooldown,
        loadFilters = {
            repository.getContactWhitelist() to repository.getContactBlacklist()
        },
    )

    suspend fun allows(contactName: String?, contactId: String?): Boolean {
        if (cooldown.isBlocked(contactName, contactId)) return false
        val filters = withContext(Dispatchers.IO) {
            loadFilters()
        }
        return ContactFilterPolicy.allowsContact(
            contactName = contactName,
            contactId = contactId,
            whitelist = filters.first,
            blacklist = filters.second,
        )
    }
}
