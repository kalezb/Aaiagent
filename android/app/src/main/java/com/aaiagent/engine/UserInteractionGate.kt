package com.aaiagent.engine

/**
 * Separates real user interaction from accessibility events caused by the
 * automation itself. Programmatic clicks and ACTION_SET_TEXT also generate
 * accessibility events, so treating every event as manual input causes the
 * automation to pause itself at the worst possible moment.
 */
class UserInteractionGate(
    private val clock: () -> Long = System::currentTimeMillis
) {
    private var lastManualInteractionAtMs: Long = 0L
    private var automationProtectedUntilMs: Long = 0L
    private var interactionEpochValue: Long = 0L

    @Synchronized
    fun onAutomationActionStarted(protectionMs: Long = 1_500L) {
        automationProtectedUntilMs = maxOf(
            automationProtectedUntilMs,
            clock() + protectionMs
        )
    }

    @Synchronized
    fun onAutomationActionFinished(graceMs: Long = 300L) {
        automationProtectedUntilMs = maxOf(
            automationProtectedUntilMs,
            clock() + graceMs
        )
    }

    @Synchronized
    fun onAccessibilityInteraction(): Boolean {
        val now = clock()
        if (now < automationProtectedUntilMs) return false
        lastManualInteractionAtMs = now
        interactionEpochValue++
        return true
    }

    @Synchronized
    fun shouldPause(windowMs: Long): Boolean {
        if (lastManualInteractionAtMs == 0L) return false
        return clock() - lastManualInteractionAtMs < windowMs
    }

    @Synchronized
    fun isAutomationActionActive(): Boolean = clock() < automationProtectedUntilMs

    @Synchronized
    fun interactionEpoch(): Long = interactionEpochValue

    @Synchronized
    fun reset() {
        lastManualInteractionAtMs = 0L
        automationProtectedUntilMs = 0L
        interactionEpochValue = 0L
    }
}

object GestureMonitor {
    private val gate = UserInteractionGate()

    fun onTouchDetected() {
        gate.onAccessibilityInteraction()
    }

    fun onAutomationActionStarted(protectionMs: Long = 1_500L) {
        gate.onAutomationActionStarted(protectionMs)
    }

    fun onAutomationActionFinished(graceMs: Long = 300L) {
        gate.onAutomationActionFinished(graceMs)
    }

    fun isUserTouchingRecently(windowMs: Long): Boolean = gate.shouldPause(windowMs)

    fun isAutomationActionActive(): Boolean = gate.isAutomationActionActive()

    fun interactionEpoch(): Long = gate.interactionEpoch()

    fun reset() = gate.reset()
}
