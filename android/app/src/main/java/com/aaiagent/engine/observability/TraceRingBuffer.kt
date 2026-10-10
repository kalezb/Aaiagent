package com.aaiagent.engine.observability

class TraceRingBuffer(
    private val capacity: Int = 5000,
) {
    private val lock = Any()
    private val events = ArrayDeque<AutomationEvent>()

    fun add(event: AutomationEvent) {
        synchronized(lock) {
            if (capacity <= 0) return
            if (events.size >= capacity) events.removeFirst()
            events.addLast(event)
        }
    }

    fun snapshot(): List<AutomationEvent> = synchronized(lock) {
        events.toList()
    }

    fun snapshotSince(timestampMs: Long): List<AutomationEvent> = synchronized(lock) {
        events.filter { it.timestampMs >= timestampMs }
    }

    fun clear() {
        synchronized(lock) {
            events.clear()
        }
    }

    fun size(): Int = synchronized(lock) {
        events.size
    }
}
