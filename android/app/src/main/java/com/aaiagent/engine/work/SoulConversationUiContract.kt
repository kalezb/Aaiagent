package com.aaiagent.engine.work

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter
import com.aaiagent.adapter.SoulAdapter
import com.aaiagent.adapter.SoulConversationScanPolicy
import com.aaiagent.engine.IncomingMessageBatch
import com.aaiagent.engine.observability.AutomationPageKind

class SoulConversationUiContract(
    private val service: AccessibilityService,
    private val adapter: SoulAdapter,
) : ConversationUiContract {
    override val platform: String = "soul"

    override fun snapshot(): ConversationUiSnapshot {
        val root = currentRoot() ?: return unavailableSnapshot()
        val observation = adapter.observePage(root)
        val texts = collectNodeText(root)
        val risk = SoulRiskOverlayPolicy.isPostRiskDialog(texts)
        return ConversationUiSnapshot(
            platform = platform,
            pageKind = if (risk) AutomationPageKind.DIALOG else observation.kind,
            reason = if (risk) SoulRiskOverlayPolicy.POST_RISK_REASON else observation.reason,
            capturedAtMs = System.currentTimeMillis(),
            contactStableId = "",
            contactName = adapter.readChatTitle(root).orEmpty(),
            unreadCount = if (observation.kind == AutomationPageKind.CONVERSATION_LIST) {
                adapter.visibleUnreadCount(root)
            } else {
                0
            },
            windowLayer = 0,
            nodeCount = texts.size,
        )
    }

    override suspend fun scanUnread(maxEntries: Int): List<ConversationIdentity> {
        return scanVisibleUnread(maxEntries)
    }

    override suspend fun scanVisibleUnread(maxEntries: Int): List<ConversationIdentity> {
        val conversations = adapter.scanVisibleUnreadConversations(
            maxEntries.coerceAtLeast(1)
        )
        val duplicateCounts = conversations
            .groupingBy { conversation ->
                SoulContactIdentityPolicy.normalizeName(conversation.contactName)
            }
            .eachCount()
        return conversations.map { conversation ->
            SoulContactIdentityPolicy.identity(
                conversation = conversation,
                duplicateNameCount = duplicateCounts[
                    SoulContactIdentityPolicy.normalizeName(conversation.contactName)
                ] ?: 1,
            )
        }
    }

    override suspend fun openConversation(
        identity: ConversationIdentity,
    ): ConversationOpenResult {
        if (identity.platform != platform) {
            return ConversationOpenResult(false, reason = "平台不匹配")
        }
        if (!SoulContactIdentityPolicy.canOpenWithoutRisk(identity)) {
            return ConversationOpenResult(
                false,
                reason = identity.note.ifBlank { "联系人身份不够确定" },
            )
        }
        val root = currentRoot() ?: return ConversationOpenResult(false, reason = "找不到消息列表")
        val opened = adapter.clickConversationByName(
            root = root,
            contactName = identity.displayName,
            shouldClick = true,
            pageIndex = identity.pageIndex,
            requireUnread = true,
        ) ?: return ConversationOpenResult(false, reason = "列表里没找到联系人")
        return ConversationOpenResult(
            opened = true,
            verifiedIdentity = identity.copy(
                displayName = opened.contactName,
                preview = opened.preview,
                origin = opened.relationshipOrigin.name.lowercase(),
            ),
            reason = "已点击联系人，等待确认聊天页",
            origin = opened.relationshipOrigin.name.lowercase(),
        )
    }

    override fun verifyConversation(expected: ConversationIdentity): ConversationOpenResult {
        val root = currentRoot() ?: return ConversationOpenResult(false, reason = "当前没有页面")
        if (!adapter.isInChat(root)) {
            return ConversationOpenResult(false, reason = "当前不是聊天页")
        }
        val title = adapter.readChatTitle(root)
        if (!SoulContactIdentityPolicy.exactNameMatches(expected.displayName, title)) {
            return ConversationOpenResult(false, reason = "聊天页联系人不是目标联系人")
        }
        return ConversationOpenResult(
            opened = true,
            verifiedIdentity = expected.copy(displayName = title.orEmpty()),
            reason = "聊天页联系人已精确确认",
        )
    }

    override fun readLatestMessages(): ConversationReadResult {
        val root = currentRoot() ?: return ConversationReadResult(false, reason = "当前没有页面")
        if (!adapter.isInChat(root)) {
            return ConversationReadResult(false, reason = "当前不是聊天页")
        }
        val messages = adapter.readMessages(root)
        return ConversationReadResult(
            read = true,
            latestIncomingFingerprint = IncomingMessageBatch.incomingHistoryFingerprint(messages),
            messages = messages.map { message ->
                ConversationUiMessage(
                    sender = message.sender,
                    type = message.type,
                    content = message.content,
                    identityKey = message.identityKey,
                    timestampText = message.timestampText,
                )
            },
            reason = "读取成功",
        )
    }

    override suspend fun sendText(
        text: String,
        operationId: String,
    ): ConversationSendResult {
        @Suppress("UNUSED_VARIABLE")
        val operation = operationId
        val root = currentRoot() ?: return ConversationSendResult(false, false, "当前没有页面")
        return when (adapter.fillAndSend(
            service = service,
            root = root,
            text = text,
            expectedContactName = null,
        )) {
            PlatformAdapter.SendResult.SUCCESS ->
                ConversationSendResult(sent = true, verified = true, reason = "发送已验证")
            PlatformAdapter.SendResult.BANNED ->
                ConversationSendResult(sent = false, verified = false, reason = "平台限制发送")
            PlatformAdapter.SendResult.TIMEOUT ->
                ConversationSendResult(sent = false, verified = false, reason = "发送超时")
            PlatformAdapter.SendResult.NOT_VERIFIED ->
                ConversationSendResult(sent = false, verified = false, reason = "聊天页未确认")
            PlatformAdapter.SendResult.STOPPED ->
                ConversationSendResult(sent = false, verified = false, reason = "本轮发送已停止")
        }
    }

    override suspend fun returnToMessageList(): Boolean {
        val root = currentRoot() ?: return false
        return adapter.navigateToMessageList(service, root)
    }

    override fun isRiskOverlay(observation: ConversationUiSnapshot): Boolean {
        return observation.reason == SoulRiskOverlayPolicy.POST_RISK_REASON
    }

    private fun currentRoot(): AccessibilityNodeInfo? {
        return service.windows
            .asSequence()
            .filter { window -> window.root?.packageName?.toString() == adapter.packageName }
            .sortedByDescending { window -> window.layer }
            .mapNotNull { window -> window.root }
            .firstOrNull()
    }

    private fun unavailableSnapshot() = ConversationUiSnapshot(
        platform = platform,
        pageKind = AutomationPageKind.UNKNOWN,
        reason = "Soul 页面不可用",
        capturedAtMs = System.currentTimeMillis(),
    )

    private fun collectNodeText(root: AccessibilityNodeInfo): List<String> {
        val output = mutableListOf<String>()
        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (output.size >= MAX_TEXT_NODES || depth > MAX_TEXT_DEPTH) return
            node.text?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let(output::add)
            node.contentDescription?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let(output::add)
            for (index in 0 until node.childCount) {
                val child = node.getChild(index) ?: continue
                walk(child, depth + 1)
            }
        }
        walk(root, 0)
        return output
    }

    private companion object {
        const val MAX_TEXT_NODES = 500
        const val MAX_TEXT_DEPTH = 30
    }
}
