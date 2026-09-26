package com.aaiagent.engine

object SoulInputState {
    fun isCleared(
        inChat: Boolean,
        sendButtonVisible: Boolean,
        inputStillContainsExpected: Boolean = false
    ): Boolean = inChat && !sendButtonVisible && !inputStillContainsExpected
}
