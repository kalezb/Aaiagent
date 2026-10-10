package com.aaiagent.engine

/**
 * Decides whether the automation may act on the visible chat page.
 *
 * The input bar is the primary signal, but Soul sometimes keeps it out of the
 * accessibility tree while a transient panel is up (light interaction,
 * inspiration reply, profile card). When the visible chat title already
 * matches the contact we are working on, that is enough to confirm the page
 * instead of dropping the conversation or the generated reply.
 */
object ChatPageAcceptancePolicy {
    fun accept(inChat: Boolean, titleMatchesContact: Boolean): Boolean {
        return inChat || titleMatchesContact
    }
}
