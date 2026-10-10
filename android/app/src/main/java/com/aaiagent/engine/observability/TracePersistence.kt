package com.aaiagent.engine.observability

import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class TracePersistence(
    private val directory: File,
    private val flushIntervalMs: Long = 1_000L,
) {
    private val queue = ConcurrentLinkedQueue<AutomationEvent>()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "automation-trace-persistence").apply { isDaemon = true }
    }
    private var file: File? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        directory.mkdirs()
        file = File(directory, TRACE_FILE)
        executor.scheduleWithFixedDelay(
            { flush() },
            flushIntervalMs,
            flushIntervalMs,
            TimeUnit.MILLISECONDS,
        )
    }

    fun enqueue(event: AutomationEvent) {
        if (!running.get()) return
        queue.offer(event)
    }

    fun flushNow() {
        flush()
    }

    fun readRecent(maxLines: Int = 5_000): List<String> {
        val current = file ?: return emptyList()
        if (!current.exists()) return emptyList()
        return runCatching { current.readLines().takeLast(maxLines.coerceAtLeast(0)) }
            .getOrDefault(emptyList())
    }

    fun directory(): File = directory

    fun shutdown() {
        if (!running.compareAndSet(true, false)) return
        flush()
        executor.shutdownNow()
    }

    private fun flush() {
        val current = file ?: return
        if (queue.isEmpty()) return
        rotateIfNeeded(current)
        val batch = buildList {
            while (true) {
                val event = queue.poll() ?: break
                add(AutomationEventCodec.toJson(event))
            }
        }
        if (batch.isEmpty()) return
        runCatching {
            current.appendText(batch.joinToString(separator = "\n", postfix = "\n"))
        }
    }

    private fun rotateIfNeeded(current: File) {
        if (!current.exists() || current.length() < MAX_FILE_BYTES) return
        val previous = File(current.parentFile, current.name + ".1")
        if (previous.exists()) previous.delete()
        current.renameTo(previous)
    }

    companion object {
        private const val TRACE_FILE = "automation_trace.jsonl"
        private const val MAX_FILE_BYTES = 16L * 1024L * 1024L
    }
}
