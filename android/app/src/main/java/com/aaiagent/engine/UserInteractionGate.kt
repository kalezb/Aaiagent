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

    /** 确认来自用户本人操作的触摸。悬浮窗等自己控件的触摸不受自动化保护时间影响。 */
    @Synchronized
    fun onManualInteraction() {
        lastManualInteractionAtMs = clock()
        interactionEpochValue++
    }

    @Synchronized
    fun shouldPause(windowMs: Long = USER_PAUSE_MS): Boolean {
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

    companion object {
        const val USER_PAUSE_MS = 5_000L
    }
}

object GestureMonitor {
    private val gate = UserInteractionGate()

    const val USER_PAUSE_MS = UserInteractionGate.USER_PAUSE_MS

    fun onTouchDetected(): Boolean = gate.onAccessibilityInteraction()

    fun onManualInteraction() = gate.onManualInteraction()

    fun onAutomationActionStarted(protectionMs: Long = 1_500L) {
        gate.onAutomationActionStarted(protectionMs)
    }

    fun onAutomationActionFinished(graceMs: Long = 300L) {
        gate.onAutomationActionFinished(graceMs)
    }

    fun isUserTouchingRecently(windowMs: Long = USER_PAUSE_MS): Boolean = gate.shouldPause(windowMs)

    fun isAutomationActionActive(): Boolean = gate.isAutomationActionActive()

    fun interactionEpoch(): Long = gate.interactionEpoch()

    fun canAutomationContinue(expectedEpoch: Long? = null): Boolean {
        if (expectedEpoch != null && interactionEpoch() != expectedEpoch) return false
        return !isUserTouchingRecently()
    }

    fun reset() = gate.reset()
}
