package com.aaiagent

import com.aaiagent.engine.work.ConversationIdentity
import com.aaiagent.engine.work.ConversationWorkEvent
import com.aaiagent.engine.work.ConversationWorkItem
import com.aaiagent.engine.work.ConversationWorkState
import com.aaiagent.engine.work.ConversationWorkStateMachine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationWorkStateMachineTest {
    private val identity = ConversationIdentity(
        platform = " Soul ",
        stableId = " user_123 ",
        displayName = "小王",
    )

    @Test
    fun `one conversation follows one linear workflow`() {
        var item = ConversationWorkItem(identity = identity, discoveredAtMs = 100L)
        item = apply(item, ConversationWorkEvent.OpenRequested, 110L)
        assertEquals(ConversationWorkState.OPENING, item.state)
        item = apply(item, ConversationWorkEvent.ChatVerified, 120L)
        assertEquals(ConversationWorkState.READING, item.state)
        item = apply(item, ConversationWorkEvent.ReadCompleted, 130L)
        assertEquals(ConversationWorkState.WAITING_REPLY, item.state)
        item = apply(item, ConversationWorkEvent.ReplyReady, 140L)
        assertEquals(ConversationWorkState.READY_TO_SEND, item.state)
        item = apply(item, ConversationWorkEvent.SendStarted, 150L)
        assertEquals(ConversationWorkState.SENDING, item.state)
        item = apply(item, ConversationWorkEvent.SendPartConfirmed(1), 160L)
        assertEquals(1, item.sentParts)
        item = apply(item, ConversationWorkEvent.SendVerified, 170L)
        assertEquals(ConversationWorkState.RETURNING, item.state)
        item = apply(item, ConversationWorkEvent.ReturnedToList, 180L)
        assertTrue(item.isComplete)
    }

    @Test
    fun `completed conversation cannot be opened or sent again`() {
        val complete = ConversationWorkItem(
            identity = identity,
            state = ConversationWorkState.COMPLETE,
            discoveredAtMs = 1L,
        )
        val reopen = ConversationWorkStateMachine.apply(
            complete,
            ConversationWorkEvent.OpenRequested,
            2L,
        )
        assertFalse(reopen.accepted)
        assertEquals(ConversationWorkState.COMPLETE, reopen.item.state)
    }

    @Test
    fun `duplicate send progress is ignored`() {
        val sending = ConversationWorkItem(
            identity = identity,
            state = ConversationWorkState.SENDING,
            discoveredAtMs = 1L,
            sentParts = 1,
        )
        val duplicate = ConversationWorkStateMachine.apply(
            sending,
            ConversationWorkEvent.SendPartConfirmed(1),
            2L,
        )
        assertFalse(duplicate.accepted)
        assertEquals(1, duplicate.item.sentParts)
    }

    @Test
    fun `retry records one attempt and can reopen only from retry state`() {
        val opening = ConversationWorkItem(
            identity = identity,
            state = ConversationWorkState.OPENING,
            discoveredAtMs = 1L,
        )
        val retry = apply(
            opening,
            ConversationWorkEvent.RetryRequested("页面没确认", 500L),
            10L,
        )
        assertEquals(ConversationWorkState.RETRY_LATER, retry.state)
        assertEquals(1, retry.attempts)
        assertEquals(510L, retry.nextAttemptAtMs)
        val reopened = apply(retry, ConversationWorkEvent.OpenRequested, 520L)
        assertEquals(ConversationWorkState.OPENING, reopened.state)
    }

    @Test
    fun `a read conversation can finish without sending when no reply is needed`() {
        val waiting = ConversationWorkItem(
            identity = identity,
            state = ConversationWorkState.WAITING_REPLY,
            discoveredAtMs = 1L,
        )
        val transition = ConversationWorkStateMachine.apply(
            waiting,
            ConversationWorkEvent.ReplyNotNeeded("对方只是道谢"),
            20L,
        )
        assertTrue(transition.accepted)
        assertTrue(transition.item.isComplete)
        assertEquals("对方只是道谢", transition.item.lastReason)
    }

    @Test
    fun `identity key is normalized and platform scoped`() {
        assertEquals("soul:user_123", identity.key)
    }

    private fun apply(
        item: ConversationWorkItem,
        event: ConversationWorkEvent,
        nowMs: Long,
    ): ConversationWorkItem {
        val transition = ConversationWorkStateMachine.apply(item, event, nowMs)
        assertTrue(transition.reason, transition.accepted)
        return transition.item
    }
}
