package com.aaiagent.engine.sampling

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.engine.ScreenCapture
import com.aaiagent.engine.observability.AutomationEvent
import com.aaiagent.engine.observability.AutomationEventCodec
import com.google.gson.GsonBuilder
import java.io.File

object PageSampler {
    private val gson = GsonBuilder().disableHtmlEscaping().create()
    private val sequenceLock = Any()

    suspend fun capture(
        service: AccessibilityService,
        platform: String,
        adapter: PlatformAdapter,
        appVersion: String,
    ): PageSampleResult? {
        val target = targetWindowRoot(service, adapter.packageName)
            ?: service.rootInActiveWindow?.takeIf {
                it.packageName?.toString() == adapter.packageName
            }
            ?: return null
        target.refresh()

        val nowMs = System.currentTimeMillis()
        val observation = runCatching { adapter.observePage(target) }.getOrNull()
        val pageKind = observation?.kind?.name ?: "UNKNOWN"
        val pageReason = observation?.reason.orEmpty()
        val chatTitle = runCatching { adapter.readChatTitle(target).orEmpty() }.getOrDefault("")
        val listSnapshot = runCatching {
            val snapshot = adapter.listSnapshot(target)
            listOf(
                snapshot.itemCount.toString(),
                snapshot.firstConversation,
                snapshot.lastConversation,
            )
        }.getOrDefault(emptyList())
        val visibleUnreadCount = runCatching {
            adapter.visibleUnreadCount(target)
        }.getOrDefault(0)
        val messages = if (pageKind == "VERIFIED_CHAT") {
            runCatching {
                adapter.readMessages(target).takeLast(MAX_MESSAGES).map { message ->
                    PageSampleMessage(
                        sender = message.sender.take(20),
                        type = message.type.take(40),
                        content = message.content.take(MAX_MESSAGE_CHARS),
                        identityKey = message.identityKey.take(300),
                        timestampText = message.timestampText.take(80),
                    )
                }
            }.getOrDefault(emptyList())
        } else {
            emptyList()
        }

        val windows = collectWindowSamples(service, adapter.packageName)
        val nodes = windows.maxByOrNull { window -> window.layer }?.nodes.orEmpty()

        val metrics = service.resources.displayMetrics
        val sequence = synchronized(sequenceLock) {
            nextSequence(service.filesDir)
        }
        val sampleId = PageSampleNamingPolicy.incidentId(platform, sequence, pageKind, nowMs)
        val payload = PageSamplePayload(
            sampleId = sampleId,
            sequence = sequence,
            platform = platform,
            packageName = target.packageName?.toString().orEmpty(),
            pageKind = pageKind,
            pageReason = pageReason,
            chatTitle = chatTitle,
            screenWidth = metrics.widthPixels,
            screenHeight = metrics.heightPixels,
            density = metrics.density,
            fontScale = service.resources.configuration.fontScale,
            appVersion = appVersion,
            capturedAtMs = nowMs,
            nodeCount = nodes.size,
            listSnapshot = listSnapshot,
            visibleUnreadCount = visibleUnreadCount,
            messages = messages,
            nodes = nodes,
            windows = windows,
        )
        val screenshot = ScreenCapture.captureJpegBase64(
            service = service,
            quality = 76,
            maxDimension = 1440,
        ).orEmpty()
        val event = AutomationEvent(
            incidentId = sampleId,
            platform = platform,
            contactId = chatTitle,
            stage = "page_sample",
            event = "page_sample_captured",
            pageKind = observation?.kind ?: com.aaiagent.engine.observability.AutomationPageKind.UNKNOWN,
            nodeFingerprint = payload.nodeCount.toString(),
            unreadCount = visibleUnreadCount,
            contentPreview = "$platform/$pageKind/$chatTitle".take(300),
            payloadJson = gson.toJson(payload),
            screenshotData = screenshot,
            appVersion = appVersion,
        )
        val directory = File(service.filesDir, SAMPLE_DIRECTORY).apply { mkdirs() }
        val file = File(directory, PageSampleNamingPolicy.fileName(sampleId))
        val saved = runCatching {
            file.writeText(AutomationEventCodec.toJson(event) + "\n")
            file
        }.getOrNull() ?: return null

        return PageSampleResult(
            sampleId = sampleId,
            sequence = sequence,
            platform = platform,
            pageKind = pageKind,
            chatTitle = chatTitle,
            nodeCount = nodes.size,
            screenshotCaptured = screenshot.isNotBlank(),
            localFile = saved.absolutePath,
            uploaded = false,
        )
    }

    private fun targetWindowRoot(
        service: AccessibilityService,
        packageName: String,
    ): AccessibilityNodeInfo? {
        return service.windows
            .asSequence()
            .filter { window -> window.root?.packageName?.toString() == packageName }
            .sortedByDescending { window -> window.layer }
            .mapNotNull { window -> window.root }
            .firstOrNull()
    }

    private fun collectWindowSamples(
        service: AccessibilityService,
        packageName: String,
    ): List<PageWindowSample> {
        var remaining = MAX_TOTAL_NODES
        return service.windows
            .asSequence()
            .filter { window -> window.root?.packageName?.toString() == packageName }
            .sortedBy { window -> window.layer }
            .mapNotNull { window ->
                val root = window.root ?: return@mapNotNull null
                root.refresh()
                val nodes = mutableListOf<PageNodeSample>()
                appendNode(
                    node = root,
                    parentIndex = -1,
                    depth = 0,
                    output = nodes,
                    maxNodes = remaining.coerceAtMost(MAX_NODES_PER_WINDOW),
                )
                remaining -= nodes.size
                PageWindowSample(
                    layer = window.layer,
                    type = window.type,
                    packageName = root.packageName?.toString().orEmpty(),
                    active = window.isActive,
                    focused = window.isFocused,
                    nodeCount = nodes.size,
                    nodes = nodes,
                )
            }
            .toList()
    }

    private fun appendNode(
        node: AccessibilityNodeInfo,
        parentIndex: Int,
        depth: Int,
        output: MutableList<PageNodeSample>,
        maxNodes: Int = MAX_NODES_PER_WINDOW,
    ) {
        if (output.size >= maxNodes) return
        val index = output.size
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        output += PageNodeSample(
            index = index,
            parentIndex = parentIndex,
            depth = depth,
            className = node.className?.toString().orEmpty().take(200),
            viewId = node.viewIdResourceName.orEmpty().take(240),
            text = node.text?.toString().orEmpty().trim().take(MAX_TEXT_CHARS),
            contentDescription = node.contentDescription?.toString().orEmpty().trim().take(MAX_TEXT_CHARS),
            clickable = node.isClickable,
            editable = node.isEditable,
            scrollable = node.isScrollable,
            enabled = node.isEnabled,
            visible = node.isVisibleToUser,
            focused = node.isFocused,
            selected = node.isSelected,
            checked = node.isChecked,
            bounds = listOf(bounds.left, bounds.top, bounds.right, bounds.bottom),
        )
        if (depth >= MAX_DEPTH) return
        for (childIndex in 0 until node.childCount) {
            if (output.size >= maxNodes) break
            val child = node.getChild(childIndex) ?: continue
            appendNode(
                node = child,
                parentIndex = index,
                depth = depth + 1,
                output = output,
                maxNodes = maxNodes,
            )
        }
    }

    private fun nextSequence(filesDir: File): Int {
        val directory = File(filesDir, SAMPLE_DIRECTORY)
        val max = directory.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && it.name.startsWith("incident-page-sample-") }
            ?.mapNotNull { file ->
                Regex("-([0-9]{4})-")
                    .find(file.name)
                    ?.groupValues
                    ?.getOrNull(1)
                    ?.toIntOrNull()
            }
            ?.maxOrNull()
            ?: 0
        return max + 1
    }

    private const val SAMPLE_DIRECTORY = "page-samples"
    private const val MAX_NODES_PER_WINDOW = 1000
    private const val MAX_TOTAL_NODES = 3000
    private const val MAX_DEPTH = 40
    private const val MAX_TEXT_CHARS = 1200
    private const val MAX_MESSAGE_CHARS = 2000
    private const val MAX_MESSAGES = 40
}
