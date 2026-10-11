package com.aaiagent.adapter

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContentValues
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.media.MediaScannerConnection
import android.net.Uri
import android.graphics.Point
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.ListSnapshot
import com.aaiagent.adapter.PlatformAdapter.SendResult
import com.aaiagent.engine.ChatTitlePolicy
import com.aaiagent.engine.ConversationStage
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.ExchangeMediaPolicy
import com.aaiagent.engine.GestureMonitor
import com.aaiagent.engine.HostingOverlayTextPolicy
import com.aaiagent.engine.InteractionVisionCache
import com.aaiagent.engine.MessagePageCachePolicy
import com.aaiagent.engine.ReplyDeliveryVerificationPolicy
import com.aaiagent.engine.ScreenCapture
import com.aaiagent.engine.SelfVoiceMemory
import com.aaiagent.engine.SoulConversationStagePolicy
import com.aaiagent.engine.SoulInputState
import com.aaiagent.engine.SoulMessageTime
import com.aaiagent.engine.SoulViewportPolicy
import com.aaiagent.engine.StickerMatcher
import com.aaiagent.engine.VoiceHandler
import com.aaiagent.engine.observability.AutomationTrace
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SoulAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "cn.soulapp.android"

    override fun observePage(root: AccessibilityNodeInfo): PageObservation {
        return SoulPageClassifier.classify(
            root = root,
            inChat = isInChat(root),
            inMessageList = isInMessageList(root),
            windowClassName = currentWindowClassName,
        )
    }

    override fun detectConversationStage(root: AccessibilityNodeInfo): ConversationStage {
        fun hasVisible(id: String): Boolean {
            return root.findAccessibilityNodeInfosByViewId(prefix + id)
                .any { node -> node.isVisibleToUser }
        }

        val hasSoulmateMarker = hasVisible("rel_soulmate") ||
            hasVisible("gif_soulmate") ||
            hasVisible("tv_soulmate_speed")
        val hasHeartMarker = hasVisible("layout_heart") ||
            hasVisible("lot_heart_pet")
        val hasProfileCard = hasVisible("clCardRoot") ||
            hasVisible("tvOtherName") ||
            hasVisible("tvPlanetArea")
        val messageList = root.findAccessibilityNodeInfosByViewId(prefix + "list_conversation")
            .firstOrNull { node -> node.isVisibleToUser }
        val messageItems = messageList
            ?.findAccessibilityNodeInfosByViewId(prefix + "item_root")
            .orEmpty()
            .filter { node -> node.isVisibleToUser }
        val outgoingCount = messageItems.count { item ->
            item.findAccessibilityNodeInfosByViewId(prefix + "message_read").isNotEmpty() ||
                item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()
        }
        return SoulConversationStagePolicy.classifyChatStage(
            hasSoulmateMarker = hasSoulmateMarker,
            hasHeartMarker = hasHeartMarker,
            hasProfileCard = hasProfileCard,
            outgoingCount = outgoingCount,
            visibleMessageCount = messageItems.size,
        )
    }

    private val prefix = "cn.soulapp.android:id/"
    private var emptyScanStreak = 0
    private val conversationLockAttempts = mutableMapOf<String, Long>()
    @Volatile
    private var currentWindowClassName: String = ""
    // 连续按了几次系统返回键还没离开当前页；见 TAP_SECONDARY_BACK 分支。
    private var secondaryBackTapStreak = 0
    @Volatile
    private var lastConfirmedChatAtMs = 0L
    // 每次读取最多打两条被拒日志，避免刷屏。
    private var rejectedItemLogCount = 0

    init {
        InteractionVisionCache.initialize(service.applicationContext)
    }

    override fun onWindowStateChanged(className: String?) {
        currentWindowClassName = className.orEmpty()
    }

    private data class LocatedMessage(
        val top: Int,
        val message: ChatMessage,
        val stickerRect: Rect? = null,
        /** 语音气泡上显示的秒数；不是语音就是 0。用来和 SelfVoiceMemory 记的文字配对。 */
        val voiceSeconds: Int = 0
    )

    private data class PendingSticker(
        val messageIndex: Int,
        val rect: Rect
    )

    private data class TopChatTabState(
        val node: AccessibilityNodeInfo,
        val selected: Boolean
    )

    /** readMessages 把待识别表情和消息索引绑定，避免混入其他消息后错位。 */
    private val pendingStickers = mutableListOf<PendingSticker>()
    private var pendingQuickMenuItems = emptyList<StickerMatcher.QuickMenuItem>()

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        if (root.packageName?.toString() != packageName) return false
        if (root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage").any(::isVisibleOnScreen)) {
            return true
        }
        // 2026-10-07 真机证据：在聊天页发消息的同一秒被判 chat=false ——
        // 输入框和消息项会短暂不在无障碍树里。标题栏（写着对方名字）是聊天页专属节点，
        // 只要标题栏在且写了名字，就按聊天页处理，不再往“未知页”跑（那条路会去点左上角进资料页）。
        // 2026-10-07 真机现场（17:20:17 雄鹰翱翔的冰原狼）：那一刻输入框节点在、标题写着对方名字，
        // 但 isVisibleToScreen 标志不可靠（重绘瞬间为假），于是仍然被判成“未知页”，导航跑去按返回。
        // 所以这里不再依赖可见性标志：**节点存在 + 标题有字** 就算聊天页。
        val inputBoxCount = root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage").size
        val titleNode = root.findAccessibilityNodeInfosByViewId(prefix + "tv_title").firstOrNull()
        val titleText = titleNode?.text?.toString()?.trim().orEmpty()
        val titleBarCount = root.findAccessibilityNodeInfosByViewId(prefix + "c_ct_chat_title_info").size
        val messageItemCount = root.findAccessibilityNodeInfosByViewId(prefix + "item_root").size
        val hasChatInput = inputBoxCount > 0
        val hasChatTitle = titleBarCount > 0 && titleText.isNotEmpty()
        val chatPage = ChatPagePolicy.isChatPage(
            inputBoxVisible = hasChatInput,
            titleBarVisible = titleBarCount > 0,
            titleVisible = titleNode != null && titleText.isNotEmpty(),
            titleText = titleText,
            messageItemCount = messageItemCount,
        )
        val now = System.currentTimeMillis()
        val explicitProfile = SoulProfileSurfacePolicy.shouldTreatAsProfilePage(
            profileMarkerCount = profileMarkerCount(root),
            hasChatInput = hasChatInput,
            hasChatTitle = hasChatTitle,
            windowClassName = currentWindowClassName,
        )
        val explicitNonChat = root.findAccessibilityNodeInfosByViewId(prefix + "conversation_list")
            .any(::isVisibleOnScreen) ||
            isPublishPage(root) ||
            explicitProfile
        val stableChat = ChatPageStabilityPolicy.shouldTreatAsChat(
            chatDetected = chatPage,
            explicitNonChat = explicitNonChat,
            lastChatAtMs = lastConfirmedChatAtMs,
            nowMs = now,
        )
        if (stableChat) {
            lastConfirmedChatAtMs = now
        } else if (explicitNonChat) {
            lastConfirmedChatAtMs = 0L
        }
        return stableChat
    }

    private fun profileMarkerCount(root: AccessibilityNodeInfo): Int {
        val includeHidden = SoulProfileSurfacePolicy.isProfileWindow(currentWindowClassName)
        return listOf(
            "user_match",
            "user_match_text",
            "collect_level_text",
            "tv_chat_secret",
            "titlebar_text_tv",
            "c_usr_user_info_behavior_container",
            "c_usr_user_all_list",
            "iv_guide_user_share",
            "v_profile_bg",
            "avatar_area",
            "follow_count_text",
        ).count { id ->
            root.findAccessibilityNodeInfosByViewId(prefix + id)
                .any { node -> includeHidden || isVisibleOnScreen(node) }
        }
    }

    override suspend fun prepareChatForAutomation(
        root: AccessibilityNodeInfo
    ): PlatformAdapter.ChatPreparation {
        cachedSignature = null
        cachedMessages = emptyList()
        val stableRoot = waitForTransientOverlayToClear(
            initialRoot = root,
            chatUsable = isInChat(root),
        )
        val lock = findConversationLockDialog(stableRoot)
            ?: return PlatformAdapter.ChatPreparation(stableRoot)
        val key = readChatTitle(stableRoot)?.trim().orEmpty().ifBlank { "unknown" }
        val now = System.currentTimeMillis()
        val lastAttempt = synchronized(conversationLockAttempts) {
            conversationLockAttempts[key] ?: 0L
        }
        if (!SoulConversationLockPolicy.shouldAttempt(now, lastAttempt)) {
            return PlatformAdapter.ChatPreparation(
                root = stableRoot,
                ready = false,
                retryAfterMs = SoulConversationLockPolicy.RETRY_COOLDOWN_MS,
            )
        }
        synchronized(conversationLockAttempts) {
            conversationLockAttempts[key] = now
        }

        android.util.Log.d("AIA", "conversation lock detected contact=$key; unlocking once")
        val tapped = tapNode(lock.unlockButton, preferGesture = true)
        delay(900)
        val fresh = service.rootInActiveWindow
        if (tapped &&
            fresh != null &&
            isInChat(fresh) &&
            findConversationLockDialog(fresh) == null
        ) {
            android.util.Log.d("AIA", "conversation lock cleared contact=$key")
            return PlatformAdapter.ChatPreparation(fresh)
        }

        lock.closeButton?.let {
            tapNode(it, preferGesture = true)
            delay(350)
        }
        android.util.Log.w("AIA", "conversation lock could not be cleared contact=$key")
        return PlatformAdapter.ChatPreparation(
            root = service.rootInActiveWindow ?: stableRoot,
            ready = false,
            retryAfterMs = SoulConversationLockPolicy.RETRY_COOLDOWN_MS,
        )
    }

    override fun readChatTitle(root: AccessibilityNodeInfo): String? {
        val candidates = root.findAccessibilityNodeInfosByViewId(prefix + "tv_title")
            .mapNotNull { node ->
                val text = node.text?.toString()?.trim().orEmpty()
                val bounds = Rect()
                node.getBoundsInScreen(bounds)
                if (text.isEmpty() || bounds.width() <= 0 || bounds.height() <= 0) return@mapNotNull null
                if (!node.isVisibleToUser &&
                    !Rect.intersects(
                        bounds,
                        Rect(
                            0,
                            0,
                            service.resources.displayMetrics.widthPixels,
                            service.resources.displayMetrics.heightPixels,
                        ),
                    )
                ) {
                    return@mapNotNull null
                }

                SoulChatTitleCandidate(
                    text = text,
                    top = bounds.top,
                    insideTopBar = findAncestorByViewId(node, "c_ct_chat_title_info") != null,
                    insideCardDescription = findAncestorByViewId(node, "cardDescContainer") != null
                )
            }
        val title = SoulChatTitlePolicy.choose(
            candidates = candidates,
            screenHeight = service.resources.displayMetrics.heightPixels
        ) ?: return null
        return ChatTitlePolicy.sanitize(title)
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        if (root.packageName?.toString() != packageName) return false
        val conversationListVisible = root.findAccessibilityNodeInfosByViewId(prefix + "conversation_list")
            .any(::isVisibleOnScreen)

        val chatTabSelected = root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
            .any(::hasSelectedState)
        val visibleConversationCount = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .count(::isVisibleOnScreen)
        val hasConversationSearch = root.findAccessibilityNodeInfosByViewId(prefix + "commonViewEtSearch")
            .any(::isVisibleOnScreen)
        val squarePageVisible = root.findAccessibilityNodeInfosByViewId(prefix + "pager_square")
            .any(::isVisibleOnScreen)
        val topChatTab = findTopChatTabState(root)
        val publishPageVisible = isPublishPage(root)

        return SoulConversationScanPolicy.isMessageList(
            conversationListVisible = conversationListVisible,
            searchVisible = hasConversationSearch,
            visibleConversationCount = visibleConversationCount,
            chatTabSelected = chatTabSelected,
            publishPageVisible = publishPageVisible,
            squarePageVisible = squarePageVisible,
            topChatTabVisible = topChatTab != null,
            topChatTabSelected = topChatTab?.selected == true,
            bottomTabSelfSelected = chatTabSelected
        )
    }

    override fun listSnapshot(root: AccessibilityNodeInfo): ListSnapshot {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .filter(::isVisibleOnScreen)
        if (items.isEmpty()) return ListSnapshot()
        return ListSnapshot(
            itemCount = items.size,
            firstConversation = readChildText(items.first(), "name") ?: "",
            lastConversation = readChildText(items.last(), "name") ?: ""
        )
    }

    /**
     * 这个节点自己是不是“点进去就跳个人资料页”的入口。
     *
     * 注意：只能看被点的这个节点本身，绝不能扫子树——会话列表的整行里就含 avatar 节点，
     * 扫子树会把整行点击都拦掉，表现为“一直在列表里滑，不进任何会话”（2026-10-05 真机踩过）。
     */
    /**
     * 只认真正的消息气泡。
     *
     * 2026-10-05 两次踩坑：
     *   太松（只看 item_root）→ 把个人主页/展品馆/收藏的内容当消息读（小胡读到 33 条）；
     *   太严（要求 layout_content）→ 新联系人页面的真消息被滤掉（野兽 items=1 bubbles=0，于是不回复）。
     * 现在的口径：只要不在个人主页卡片/媒体面板里，且有文字或媒体节点，就算消息。
     */
    private fun hasMessageContent(item: AccessibilityNodeInfo): Boolean {
        if (item.findAccessibilityNodeInfosByViewId(prefix + "content_text").isNotEmpty()) return true
        if (item.findAccessibilityNodeInfosByViewId(prefix + "content_text_container").isNotEmpty()) {
            return true
        }
        return MESSAGE_MEDIA_IDS.any { id ->
            item.findAccessibilityNodeInfosByViewId(prefix + id).any { it.isVisibleToUser }
        }
    }

    /** 被拒的消息条目打一条日志：包含它的祖先 id 链，便于下次直接定位是哪条规则拒的。 */
    private fun logRejectedItem(item: AccessibilityNodeInfo, reason: String) {
        if (rejectedItemLogCount >= 2) return
        rejectedItemLogCount += 1
        val path = mutableListOf<String>()
        var current: AccessibilityNodeInfo? = item
        repeat(6) {
            val node = current ?: return@repeat
            path.add(node.viewIdResourceName.orEmpty().removePrefix(prefix))
            current = node.parent
        }
        android.util.Log.d("AIA", "read reject reason=$reason path=${path.joinToString(">")}")
    }

    /** 节点是否在“个人主页/关系卡片”里（这些内容不是聊天消息）。 */
    private fun isInsideProfileCard(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        repeat(8) {
            val candidate = current ?: return false
            val id = candidate.viewIdResourceName.orEmpty().removePrefix(prefix)
            if (PROFILE_CARD_IDS.any { id == it }) return true
            current = candidate.parent
        }
        return false
    }

    /** 节点是否在音乐/视频/表情/快捷菜单这类面板里（这些面板的条目不是聊天消息）。 */
    private fun isInsideNonMessagePanel(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        repeat(8) {
            val candidate = current ?: return false
            val id = candidate.viewIdResourceName.orEmpty().removePrefix(prefix)
            if (NON_MESSAGE_PANEL_IDS.any { id == it }) return true
            current = candidate.parent
        }
        return false
    }

    private fun isProfileEntryPoint(node: AccessibilityNodeInfo): Boolean {
        val id = node.viewIdResourceName.orEmpty().removePrefix(prefix)
        if (PROFILE_ENTRY_IDS.any { id == it }) return true
        val description = node.contentDescription?.toString()?.trim().orEmpty()
        return description == "访问主页" || description == "个人资料" || description == "主页"
    }

    /**
     * 当前会话那一页。
     *
     * 2026-10-05 真机（格桑知我、砂锅串串，都是全新联系人）：Soul 用 ViewPager 装聊天页，
     * 上一个会话的整页气泡还留在无障碍树里，读取器把两个会话混着读——
     * 实测在一个只有 1 条表情消息的新联系人页面上读到了 40 条，最后一条是我方消息，
     * 于是判成“无需回复”，退出时又点到左上角的头像，进了个人资料页。
     * 输入框只属于当前会话，从它往上找第一个含气泡的祖先就是当前页（不跨 ViewPager）。
     */
    private fun activeChatPage(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val input = root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage")
            .firstOrNull { it.isVisibleToUser }
            ?: return null
        var current: AccessibilityNodeInfo? = input
        repeat(8) {
            val node = current ?: return null
            if (node.viewIdResourceName == prefix + "c_ct_viewpager") return null
            if (node.findAccessibilityNodeInfosByViewId(prefix + "item_root").isNotEmpty()) return node
            current = node.parent
        }
        return null
    }

    /**
     * 选出当前会话的气泡。
     *
     * 2026-10-05 真机：Soul 把多个会话的气泡缓存留在同一页的无障碍树里，
     * 在一个只有 1 条消息的新联系人页面上读到过 42 条（含上一个会话，最后一条是我方回复），
     * 于是判成“无需回复”并退出。这里按每个 list_conversation 分组，
     * 优先选“最后一条能跟列表那行预览对上”的那一组；都对不上才退回输入框所在页。
     */
    private fun selectMessageItems(
        root: AccessibilityNodeInfo,
        expectedPreview: String,
    ): List<AccessibilityNodeInfo> {
        val containers = root.findAccessibilityNodeInfosByViewId(prefix + "list_conversation")
            .filter { it.isVisibleToUser }
        val groups = if (containers.isNotEmpty()) containers else listOf(root)
        val grouped = groups.map { container ->
            container to container.findAccessibilityNodeInfosByViewId(prefix + "item_root")
        }.filter { (_, items) -> items.isNotEmpty() }
        if (grouped.size > 1 && expectedPreview.isNotBlank()) {
            grouped.firstOrNull { (_, items) ->
                previewLooksLike(lastContentText(items.lastOrNull()), expectedPreview)
            }?.let { (_, items) -> return items }
        }
        val activePage = activeChatPage(root)
        if (activePage != null) {
            grouped.firstOrNull { (container, _) ->
                isDescendantOf(container, activePage)
            }?.let { (_, items) -> return items }
        }
        return grouped.maxByOrNull { (_, items) -> items.size }?.second
            ?: root.findAccessibilityNodeInfosByViewId(prefix + "item_root")
    }

    /**
     * 兜底：页面上确实有 item_root，但按气泡规则一条都没留下时，放宽到“只排除主页卡片和媒体面板”。
     * 2026-10-05 真机（野兽 items=1 bubbles=0、不许偷看… items=1 bubbles=0）：
     * 新联系人页面里那条真消息不含 content_text 也没有媒体节点，被严格规则滤掉，
     * 结果一条不剩 → 判“无需回复” → 用户看到不回复还退出。宁可放宽，也不能把真消息漏掉。
     */
    private fun fallbackBubbles(items: List<AccessibilityNodeInfo>): List<AccessibilityNodeInfo> {
        val relaxed = items.filter { item ->
            !isInsideProfileCard(item) && !isInsideNonMessagePanel(item)
        }
        if (relaxed.isNotEmpty() && relaxed.size != items.size) {
            android.util.Log.w(
                "AIA",
                "read fallback relaxed items=${items.size} relaxed=${relaxed.size}"
            )
        }
        return relaxed
    }

    /** 列表预览和气泡文字常常只有前缀相同（预览会被截断、还可能是表情代号）。 */
    private fun previewLooksLike(lastText: String?, preview: String): Boolean {
        val last = lastText?.replace(Regex("\\s+"), "")?.trim().orEmpty()
        val head = preview.replace(Regex("\\s+"), "").trim().removeSuffix("…").removeSuffix("...")
        if (last.isEmpty() || head.isEmpty()) return false
        val probe = minOf(last.length, head.length, 12)
        return probe > 0 && last.take(probe) == head.take(probe)
    }

    private fun lastContentText(item: AccessibilityNodeInfo?): String? {
        val target = item ?: return null
        return target.findAccessibilityNodeInfosByViewId(prefix + "content_text")
            .mapNotNull { it.text?.toString()?.trim() }
            .firstOrNull { it.isNotEmpty() }
    }

    private fun isDescendantOf(node: AccessibilityNodeInfo, ancestor: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        repeat(12) {
            val candidate = current ?: return false
            if (candidate == ancestor) return true
            current = candidate.parent
        }
        return false
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> =
        readMessages(root, "")

    // ── 页面签名缓存 ──────────────────────────────────────────────────────
    // 真机实测（2026-10-07）：读一次 7~9 条的聊天页要 2.8~4.0 秒，而一次回复
    // 总共要读 6~15 次（1 段读 6 次，2 段读 11~15 次）。这些读里大半读的是
    // 同一个没变过的页面，纯属白读。所以先用几次廉价查找算个签名，没变就复用。
    @Volatile
    private var cachedMessages: List<ChatMessage> = emptyList()

    @Volatile
    private var cachedSignature: String? = null

    override fun readMessages(
        root: AccessibilityNodeInfo,
        expectedPreview: String,
    ): List<ChatMessage> {
        val signature = messagePageSignature(root, expectedPreview)
        if (MessagePageCachePolicy.shouldReuse(cachedSignature, signature)) {
            return cachedMessages
        }
        val parsed = parseMessages(root, expectedPreview)
        if (signature != null) {
            cachedSignature = signature
            cachedMessages = parsed
        }
        return parsed
    }

    /**
     * 聊天页的廉价签名：只做几次查找，不做逐条解析（全量解析要 20+ 次查找）。
     *
     * 覆盖会让读出来的消息发生变化的几件事：换了会话、条数变了、最后一条变了、
     * 已读回执变了（回执会决定一条老消息算谁的，不改它方向判定就会吃到旧值）。
     * 任何一项拿不到就返回 null —— 那就老实全量解析，绝不拿旧数据糊弄。
     */
    private fun messagePageSignature(
        root: AccessibilityNodeInfo,
        expectedPreview: String,
    ): String? {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")
            .filter { it.isVisibleToUser }
        if (items.isEmpty()) return null
        val last = items.last()
        val lastText = last.findAccessibilityNodeInfosByViewId(prefix + "content_text")
            .mapNotNull { it.text?.toString()?.trim() }
            .joinToString("")
        val lastVoiceLength = last.findAccessibilityNodeInfosByViewId(prefix + "tv_length")
            .mapNotNull { it.text?.toString()?.trim() }
            .firstOrNull()
            .orEmpty()
        val readMarks = root.findAccessibilityNodeInfosByViewId(prefix + "message_read").size
        val title = readChatTitle(root).orEmpty()
        return expectedPreview + "\u001f" + title + "\u001f" + items.size + "\u001f" +
            readMarks + "\u001f" + lastVoiceLength + "\u001f" + lastText
    }

    private fun parseMessages(
        root: AccessibilityNodeInfo,
        expectedPreview: String,
    ): List<ChatMessage> {
        val screenWidth = service.resources.displayMetrics.widthPixels
        val messageItems = selectMessageItems(root, expectedPreview)
        val strictContentCount = messageItems.count(::hasMessageContent)
        val useRelaxedFallback = SoulConversationScanPolicy.shouldUseFallbackBubbles(
            itemCount = messageItems.size,
            strictContentCount = strictContentCount,
            minItemsForStrictCheck = MIN_ITEMS_FOR_STRICT_CHECK,
        )
        val effectiveItems = if (useRelaxedFallback) {
            fallbackBubbles(messageItems)
        } else {
            messageItems
        }
        // 条目很少（新会话通常 1-3 条）时不做内容形态校验：这些基本就是对方的真消息，
        // 再按严格规则筛会把真消息滤掉（真机：野兽 items=1 bubbles=0）。条目多时才严格筛（防主页垃圾）。
        val relaxContentCheck = effectiveItems.size <= MIN_ITEMS_FOR_STRICT_CHECK ||
            useRelaxedFallback
        // 2026-10-05 真机（⚽️）：新联系人页面的关系卡片动画还没结束时，整条消息的 isVisibleToUser
        // 仍然是 false，逐个跳过会让 bubbles=0，于是判“没有未回消息”就不回复（也不打任何 reject 日志）。
        // 整页都不可见时按可见处理；只要有一条可见，就维持原来的严格行为。
        val forceVisible = effectiveItems.isNotEmpty() && effectiveItems.none { it.isVisibleToUser }
        if (forceVisible) {
            android.util.Log.w("AIA", "read forceVisible items=${effectiveItems.size}")
        }
        val timestampTracker = SoulMessageTime.ContextTracker()
        val locatedMessages = mutableListOf<LocatedMessage>()
        // 连续气泡没有头像时用来延续收发方向（见下面的 sender 判定）。
        var previousSender = ""
        pendingStickers.clear()
        rejectedItemLogCount = 0
        pendingQuickMenuItems = readQuickMenuItems(root)

        for (item in effectiveItems) {
            if (!forceVisible && !item.isVisibleToUser) continue
            if (isInsideTransientOverlay(item)) continue
            // 2026-10-05 真机：音乐/视频/表情选择面板里的条目 id 也是 item_root，
            // 被当成消息读了进来（缓存里出现过“正在加载、IP属地:四川、全部、忘川彼岸、视频”），
            // 上下文被污染，模型就开始对牛弹琴。这些面板里的东西一律不算消息。
            if (isInsideNonMessagePanel(item)) continue
            // 2026-10-05 真机：新联系人的页面里还挂着“个人主页/展品馆/收藏/瞬间”的内容，
            // 它们 id 也叫 item_root，被当成消息读了（缓存里出现过星球名、标签、收藏、IP属地）。
            // 只认真正的消息气泡：必须有 layout_content，且带文字容器或媒体节点。
            if (isInsideProfileCard(item)) {
                logRejectedItem(item, "profileCard")
                continue
            }
            if (isInsideNonMessagePanel(item)) {
                logRejectedItem(item, "panel")
                continue
            }
            if (!relaxContentCheck && !hasMessageContent(item)) {
                logRejectedItem(item, "noContent")
                continue
            }
            val observedTimestamp = item.findAccessibilityNodeInfosByViewId(prefix + "timestamp")
                .mapNotNull { it.text?.toString()?.trim() }
                .firstOrNull { it.isNotEmpty() }
                .orEmpty()
            val timestamp = timestampTracker.observe(observedTimestamp)
            if (item.findAccessibilityNodeInfosByViewId(prefix + "aigcRootView").isNotEmpty()) continue
            val hasSnapPhoto = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_receive_root").isNotEmpty()
            val hasSentSnapPhoto = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_sender_root").isNotEmpty()
            val hasSnapExchange = item.findAccessibilityNodeInfosByViewId(prefix + "item_roote_snap_exchange_photo").isNotEmpty()
            val hasPrivacyTag = item.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag").isNotEmpty()
            if (SoulExchangePolicy.shouldSkipPrivacyShell(
                    hasPrivacyTag = hasPrivacyTag,
                    hasSnapPhotoReceiveRoot = hasSnapPhoto,
                    hasSnapPhotoSenderRoot = hasSentSnapPhoto,
                    hasSnapExchangeRoot = hasSnapExchange
                )
            ) {
                continue
            }

            // 2026-10-06 真机：Soul 会把同一个人连着发的几条合并成一组，组里第二三条不再带头像。
            // 没有头像也没有已读回执时，方向判定会退回按内容中心点猜；长消息中心点偏左就被判成对方发的。
            // 结果她自己的消息被读成对方的，同一句回了两遍。信号全缺时延续上一条的方向。
            val rawSender = readMessageSender(item, screenWidth)
            val sender = if (rawSender == "other" && senderSignalsMissing(item) && previousSender.isNotEmpty()) {
                previousSender
            } else {
                rawSender
            }
            previousSender = sender
            // 转发动态卡片：作者和正文都在卡片节点里，直接读出来（不做任何匹配）。
            val momentCardContent = readMomentCardContent(item, forwardedByOther = sender == "other")

            val text = item.findAccessibilityNodeInfosByViewId(prefix + "content_text")
                .mapNotNull { it.text?.toString()?.trim() }
                .filter { it.isNotEmpty() }
                .joinToString("")

            val voiceTranscription = item.findAccessibilityNodeInfosByViewId(prefix + "audioContent")
                .mapNotNull { it.text?.toString()?.trim() }
                .filter { it.isNotEmpty() }
                .joinToString(" ")

            val hasVoice = hasAnyVisibleViewId(item, VOICE_TARGET_IDS) ||
                hasDescendantViewIdFragment(item, VOICE_ID_FRAGMENTS)
            val hasVoiceEmoji = SoulVoiceMediaKind.isVoiceEmoji(
                hasEmojiIcon = hasAnyVisibleViewId(item, VOICE_EMOJI_ICON_IDS),
                hasVoicePlay = hasAnyVisibleViewId(item, VOICE_EMOJI_PLAY_IDS),
                hasPlayStart = hasAnyVisibleViewId(item, VOICE_EMOJI_START_IDS),
                hasNormalVoiceBubble = hasAnyVisibleViewId(item, REGULAR_VOICE_IDS)
            )
            val expressionContainer = item.findAccessibilityNodeInfosByViewId(prefix + "llExpression")
                .firstOrNull { it.isVisibleToUser }
            val expressionStickerNode = expressionContainer
                ?.findAccessibilityNodeInfosByViewId(prefix + "image")
                ?.firstOrNull { it.isVisibleToUser }
            // llExpression is Soul's ordinary sticker card, not one of the 14
            // light-interaction templates. Keep it on the local fixed-reply path.
            val hasImage = expressionStickerNode == null && (
                SoulMediaType.hasImageBubble(
                    hasImageMarker = item.findAccessibilityNodeInfosByViewId(prefix + "image").isNotEmpty() ||
                        item.findAccessibilityNodeInfosByViewId(prefix + "image_content").isNotEmpty() ||
                        item.findAccessibilityNodeInfosByViewId(prefix + "chat_image_url").isNotEmpty(),
                    hasIncomingSnapPhoto = hasSnapPhoto,
                    hasOutgoingSnapPhoto = hasSentSnapPhoto
                )
            )
            val hasExchange = isExchangeItem(item)
            val lightInteractionNode = item.findAccessibilityNodeInfosByViewId(prefix + "la_light_interaction")
                .firstOrNull { it.isVisibleToUser }
            val staticStickerNode = item.findAccessibilityNodeInfosByViewId(prefix + "img_static")
                .firstOrNull { it.isVisibleToUser }
            val isBareStaticSticker = text.isEmpty() &&
                voiceTranscription.isEmpty() &&
                !hasVoice &&
                !hasVoiceEmoji &&
                !hasImage &&
                !hasSnapPhoto &&
                !hasExchange &&
                momentCardContent == null
            val interactionKind = SoulInteractionKind.resolve(
                hasLightInteraction = lightInteractionNode != null,
                hasBareStaticSticker = staticStickerNode != null && isBareStaticSticker
            )
            val stickerNode = when (interactionKind) {
                SoulInteractionKind.LIGHT -> lightInteractionNode
                SoulInteractionKind.STATIC -> staticStickerNode
                else -> null
            }
            val type = SoulMediaType.resolve(
                hasVoiceEmoji = hasVoiceEmoji,
                hasVoice = hasVoice,
                hasImage = hasImage,
                hasSnapPhoto = hasSnapPhoto,
                hasText = text.isNotEmpty(),
                hasExchange = hasExchange,
                hasMomentCard = momentCardContent != null,
                hasSticker = expressionStickerNode != null
            )

            // 语音气泡上显示的秒数，用来和"我发语音时记下的文字"配对（见 SelfVoiceMemory）。
            val voiceSeconds = if (type == SoulMediaType.VOICE) {
                SoulVoiceRecordPolicy.parseLengthSeconds(
                    item.findAccessibilityNodeInfosByViewId(prefix + "tv_length")
                        .mapNotNull { it.text?.toString() }
                        .firstOrNull()
                ) ?: 0
            } else {
                0
            }
            val content = when {
                type == SoulMomentCard.TYPE -> momentCardContent ?: SoulMomentCard.FALLBACK
                type == SoulMediaType.VOICE_EMOJI -> "[语音互动表情]"
                type == SoulMediaType.VOICE && sender != "other" ->
                    SoulVoiceContent.resolveIncoming(voiceTranscription, text)
                // 自己发的语音：先放占位，等排序之后统一按"时长 + 顺序"补上当时说的话。
                type == SoulMediaType.VOICE -> SoulVoiceContent.resolveOutgoing(null, text)
                type == SoulMediaType.STICKER -> "[表情]"
                text.isNotEmpty() -> text
                stickerNode != null -> "[Soul互动表情]"
                type == "exchange" -> "[以图换图]"
                type == "image" -> if (hasSnapPhoto) "[闪照]" else "[图片]"
                else -> ""
            }
            // 编号锚点：**不论方向，语音一律用固定的 [语音] 算**。
            //
            // 拿转写后的内容算编号会出大事：转写一出现，同一条语音的编号就变了，
            // 在系统眼里成了"另一条新消息" —— 去重、批次挑选、来源归属全跟着错乱。
            // 真机症状（2026-10-06）：转写成功后重读聊天页拿回来的是空内容，
            // 大模型以为对方什么都没说，回了句"再说一遍呀，想听你说"。
            // 内容该带文字就带文字（大模型要看得见），编号必须稳。
            val identityContent = SoulVoiceContent.identityAnchor(
                isVoice = type == SoulMediaType.VOICE,
                content = content
            )
            val finalType = if (stickerNode != null && text.isEmpty()) {
                SoulInteractionMessage.TYPE
            } else {
                type
            }
            val stickerRect = stickerNode?.let {
                Rect().also { rect -> it.getBoundsInScreen(rect) }
            }
            val itemBounds = Rect()
            item.getBoundsInScreen(itemBounds)
            // 系统提示行（IP属地、撤回、正在输入、时间分隔）不是消息，读进来会污染“最后一条”。
            if (content.isNotEmpty() && SoulSystemNoticePolicy.isNotice(content)) continue
            if (content.isNotEmpty()) {
                locatedMessages.add(
                    LocatedMessage(
                        top = itemBounds.top,
                        message = ChatMessage(
                            sender = sender,
                            content = content,
                            type = finalType,
                            timestampText = timestamp.text,
                            timestampMillis = timestamp.epochMillis,
                            identityKey = SoulMessageIdentity.key(
                                sender = sender,
                                type = finalType,
                                content = identityContent,
                            ),
                            transcript = voiceTranscription,
                            voiceSeconds = voiceSeconds,
                        ),
                        stickerRect = stickerRect,
                        voiceSeconds = voiceSeconds
                    )
                )
            }
        }

        // 汇总一条日志：读了多少个 item_root、其中多少个是真气泡，方便核对混读。
        android.util.Log.d(
            "AIA",
            "read items=${messageItems.size} bubbles=${locatedMessages.size} preview=${expectedPreview.take(16)}"
        )
        locatedMessages.addAll(readSystemInteractionMessages(root))
        val messages = mutableListOf<ChatMessage>()
        if (locatedMessages.isEmpty()) {
            fallbackReadTextViews(root, messages, screenWidth)
            return messages
        }

        // 自己发的语音：位置和时长按聊天顺序收集，读完统一补内容。
        val selfVoicePositions = mutableListOf<Int>()
        val selfVoiceSeconds = mutableListOf<Int>()
        locatedMessages
            .sortedBy { it.top }
            .forEachIndexed { index, located ->
                messages.add(located.message)
                if (located.message.sender != "other" &&
                    located.message.type == SoulMediaType.VOICE
                ) {
                    selfVoicePositions.add(index)
                    selfVoiceSeconds.add(located.voiceSeconds)
                }
                located.stickerRect?.let { pendingStickers.add(PendingSticker(index, it)) }
            }
        attachSelfVoiceTexts(root, messages, selfVoicePositions, selfVoiceSeconds)
        // 本 App 自己的悬浮窗 / 前台服务文字会被一起读进来，绝不能当成聊天消息
        // （真机 2026-10-07：`AI 托管` / `已开启 AI 托管` 被当成消息入库并同步给后端）。
        return messages.filterNot { HostingOverlayTextPolicy.isOverlayText(it.content) }
    }

    /**
     * 给"自己发的语音"补上当时说的话。
     *
     * Soul 的语音气泡里只有「[语音]」，不补的话大模型看不到自己说过什么，
     * 就会重复自己刚说的话或者接不上对方的话（真机 2026-10-06 观察到）。
     *
     * 配对靠「录音时长 + 顺序」，**不靠消息编号** —— 编号里带内容，
     * 内容一改编号就变，同一条语音会被当成两条。所以这里只改 content，
     * identityKey 已经按 [语音] 算好了、一个字不动。
     */
    private fun attachSelfVoiceTexts(
        root: AccessibilityNodeInfo,
        messages: MutableList<ChatMessage>,
        positions: List<Int>,
        durationsSeconds: List<Int>
    ) {
        if (positions.isEmpty()) return
        val conversationKey = readChatTitle(root)?.trim().orEmpty().ifEmpty { packageName }
        val spoken = SelfVoiceMemory.match(conversationKey, durationsSeconds)
        positions.forEachIndexed { i, position ->
            val text = spoken.getOrNull(i) ?: return@forEachIndexed
            val original = messages.getOrNull(position) ?: return@forEachIndexed
            // 占位不算"文字说明"，别把它拼进去。
            val caption = original.content
                .takeIf { it != SoulVoiceContent.PLACEHOLDER }
                .orEmpty()
            messages[position] = original.copy(
                content = SoulVoiceContent.resolveOutgoing(text, caption)
            )
        }
    }

    override suspend fun transcribeIncomingVoices(
        root: AccessibilityNodeInfo
    ): PlatformAdapter.VoiceTranscriptionResult {
        val screenWidth = service.resources.displayMetrics.widthPixels
        // 先用和 readMessages 一样的规则（含"方向信号缺失就延续上一条"）算好每条消息的方向，
        // 按屏幕位置索引。
        //
        // 只调 readMessageSender 是不够的：Soul 会把同一个人连发的几条合并成一组，
        // 组里第二三条既没有头像也没有已读回执，按中心点猜很容易把"自己刚发的语音"
        // 猜成对方的 —— 于是白点一次"转文字"，上下文里还多出一条
        // "对方语音转文字：…" 挂在自己头上（真机 2026-10-06 观察到）。
        val incomingBounds = incomingItemBounds(root, screenWidth)
        return VoiceHandler.transcribeIncomingVoices(
            service = service,
            root = root,
            isIncomingItem = { item ->
                val bounds = Rect()
                item.getBoundsInScreen(bounds)
                if (incomingBounds.contains(bounds.top to bounds.bottom)) {
                    true
                } else {
                    // 位置对不上（例如转文字展开后布局变了）：宁可漏转，
                    // 也不要把自己发的语音当成对方的。
                    readMessageSender(item, screenWidth) == "other" && !senderSignalsMissing(item)
                }
            }
        )
    }

    /** 按"延续上一条方向"的规则，算出哪些消息（用屏幕位置标识）是对方发的。 */
    private fun incomingItemBounds(
        root: AccessibilityNodeInfo,
        screenWidth: Int
    ): Set<Pair<Int, Int>> {
        val result = mutableSetOf<Pair<Int, Int>>()
        var previousSender = ""
        for (item in root.findAccessibilityNodeInfosByViewId(prefix + "item_root")) {
            val raw = readMessageSender(item, screenWidth)
            val sender = if (raw == "other" && senderSignalsMissing(item) && previousSender.isNotEmpty()) {
                previousSender
            } else {
                raw
            }
            previousSender = sender
            if (sender == "other") {
                val bounds = Rect()
                item.getBoundsInScreen(bounds)
                result.add(bounds.top to bounds.bottom)
            }
        }
        return result
    }

    /**
     * Taps the bottom message tab, falling back to a single BACK press so a
     * profile page with a hidden tab bar can still reach the message list.
     */
    private fun tapMessageTabOrBack(root: AccessibilityNodeInfo): Boolean {
        val messageTab = findMessageTab(root)
        if (messageTab != null && tapNode(messageTab, preferGesture = true, source = "open:messageTab")) return true
        return service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }

    /**
     * 对 readMessages 标记的 "[Soul互动表情]" 消息做本地截图识别，替换为具体表情名。
     * 返回替换后的 messages 副本。
     */
    suspend fun recognizePendingStickers(
        messages: List<ChatMessage>,
        expectedLatestPreview: String = ""
    ): StickerRecognitionResult {
        if (pendingStickers.isEmpty()) return StickerRecognitionResult(messages)
        val result = messages.toMutableList()
        val previewLabel = SoulInteractionPreview.resolve(expectedLatestPreview)
        val validPending = pendingStickers.filter { pending ->
            val index = pending.messageIndex
            index in messages.indices && messages[index].type == SoulInteractionMessage.TYPE
        }
        val unresolved = mutableSetOf<Int>()
        val remainingPending = mutableListOf<PendingSticker>()

        validPending.forEach { pending ->
            val isLatestIncoming = pending.messageIndex == messages.lastIndex &&
                messages[pending.messageIndex].sender == "other"
            if (isLatestIncoming && !previewLabel.isNullOrBlank()) {
                val modelText = if (SoulGameInteraction.isGameLabel(previewLabel)) {
                    SoulGameInteraction.modelTextFor(previewLabel)
                } else {
                    SoulInteractionPreview.modelTextFor(previewLabel)
                }
                result[pending.messageIndex] = result[pending.messageIndex].copy(
                    content = modelText,
                    type = "text"
                )
            } else {
                remainingPending.add(pending)
            }
        }

        if (remainingPending.isNotEmpty()) {
            val match = StickerMatcher.matchAllDetailed(
                service = service,
                boundsList = remainingPending.map { it.rect },
                quickMenuItems = pendingQuickMenuItems
            )
            remainingPending.forEachIndexed { index, pending ->
                val name = match.names.getOrNull(index)
                val quickMenuLabel = match.quickMenuLabels.getOrNull(index)
                val modelText = when {
                    !quickMenuLabel.isNullOrBlank() && SoulGameInteraction.isGameLabel(quickMenuLabel) ->
                        SoulGameInteraction.modelTextFor(quickMenuLabel)
                    !name.isNullOrBlank() -> StickerMatcher.modelTextFor(name)
                    else -> null
                }
                if (modelText.isNullOrBlank()) {
                    unresolved.add(pending.messageIndex)
                } else {
                    result[pending.messageIndex] = result[pending.messageIndex].copy(
                        content = modelText,
                        type = "text"
                    )
                }
            }
        }
        return StickerRecognitionResult(
            messages = result,
            failedIndexes = unresolved
        )
    }

    data class StickerRecognitionResult(
        val messages: List<ChatMessage>,
        val failedIndexes: Set<Int> = emptySet()
    )

    override fun readVisualTargetBounds(
        root: AccessibilityNodeInfo,
        targetType: String?
    ): Rect? {
        val item = findLatestIncomingVisualItem(root, targetType = targetType) ?: return null
        for (target in targetIdsFor(targetType)) {
            val node = item.findAccessibilityNodeInfosByViewId(prefix + target)
                .firstOrNull { it.isVisibleToUser }
                ?: continue
            val rect = Rect()
            node.getBoundsInScreen(rect)
            if (rect.width() > 0 && rect.height() > 0) return rect
        }
        return null
    }

    override suspend fun prepareVisualCapture(
        root: AccessibilityNodeInfo,
        targetType: String?,
        exchangeImageBytes: ByteArray?
    ): PlatformAdapter.VisualCapturePreparation? {
        val item = findLatestIncomingVisualItem(root, targetType = targetType)
            ?: return PlatformAdapter.VisualCapturePreparation(root)
        if (isExchangeItem(item)) {
            // 兑换图流程也会打开相册（带遮罩），失败时同样要退回来。
            val exchange = completeExchangeAndOpenIncoming(item, exchangeImageBytes)
            if (exchange == null) closeMediaFlow(null)
            return exchange
        }
        val snapPhoto = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_receive_root")
            .firstOrNull { it.isVisibleToUser }
            ?: return PlatformAdapter.VisualCapturePreparation(root)

        // 2026-10-07 用户要求：闪照本身就是隐私图，直接按“随口夸一句”回，
        // 不用点开预览，更不用截图（以前点开会截屏，把我们自己的悬浮窗拍进去，
        // 视觉模型描述成“托管界面”，她就照着回了“你这是给我看托管界面呀”）。
        android.util.Log.d("AIA", "snap photo detected: use privacy reply without capture")
        return PlatformAdapter.VisualCapturePreparation(root, privacyProtected = true)
    }

    override suspend fun finishVisualCapture(root: AccessibilityNodeInfo) {
        val activeRoot = service.rootInActiveWindow ?: return
        if (isPrivacyPreview(activeRoot)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(600)
        }
    }

    private suspend fun completeExchangeAndOpenIncoming(
        exchangeItem: AccessibilityNodeInfo,
        exchangeImageBytes: ByteArray?
    ): PlatformAdapter.VisualCapturePreparation? {
        if (!automationMayContinue()) return null
        if (exchangeImageBytes == null || exchangeImageBytes.isEmpty()) {
            android.util.Log.w("AIA", "Soul exchange blocked because daily photo is unavailable")
            return null
        }
        val mediaUri = withContext(Dispatchers.IO) {
            persistOutgoingImage(
                imageBytes = exchangeImageBytes,
                fileName = ExchangeMediaPolicy.FILE_NAME,
                contentType = ExchangeMediaPolicy.CONTENT_TYPE
            )
        } ?: return null

        try {
            delay(900)
            if (!automationMayContinue()) return null
            val entry = findExchangeEntryNode(exchangeItem) ?: return null
            if (!tapNode(entry)) return null

            val albumRoot = waitForRoot(6, 800) { isAlbumPicker(it) } ?: run {
                android.util.Log.w("AIA", "Soul exchange album did not open")
                recoverToChat()
                return null
            }
            val firstPhoto = findFirstAlbumPhoto(albumRoot) ?: run {
                android.util.Log.w("AIA", "Soul exchange daily photo was not found in album")
                recoverToChat()
                return null
            }
            if (!tapNode(firstPhoto)) {
                recoverToChat()
                return null
            }

            val previewRoot = waitForRoot(6, 700) { isExchangePreview(it) } ?: run {
                android.util.Log.w("AIA", "Soul exchange preview did not open")
                recoverToChat()
                return null
            }
            if (!ensureExchangePrivacy(previewRoot)) {
                android.util.Log.w("AIA", "Soul exchange blocked because privacy could not be verified")
                recoverToChat()
                return null
            }

            submitExchange(previewRoot) ?: run {
                android.util.Log.w("AIA", "Soul exchange submit did not return to chat")
                recoverToChat()
                return null
            }
            val protectedChat = waitForRoot(10, 700) {
                isInChat(it) && containsProtectedExchange(it)
            } ?: run {
                android.util.Log.w("AIA", "Soul exchange sent without a verifiable privacy tag")
                return null
            }
            android.util.Log.d("AIA", "Soul exchange privacy verified: ${SoulExchangePolicy.PROTECTED_TAG}")

            val incomingImage = findLatestIncomingVisualItem(protectedChat, includeExchange = false)
                ?: return PlatformAdapter.VisualCapturePreparation(protectedChat, exchangeSubmitted = true)
            val imageTarget = findIncomingImageTarget(incomingImage) ?: return null
            if (!tapNode(imageTarget)) {
                return PlatformAdapter.VisualCapturePreparation(protectedChat, exchangeSubmitted = true)
            }
            val imagePreview = waitForRoot(5, 700) { isImagePreview(it) }
                ?: return PlatformAdapter.VisualCapturePreparation(protectedChat, exchangeSubmitted = true)
            val privacyProtected = incomingImage.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag")
                .isNotEmpty()
            return PlatformAdapter.VisualCapturePreparation(
                root = imagePreview,
                privacyProtected = privacyProtected,
                exchangeSubmitted = true
            )
        } finally {
            withContext(Dispatchers.IO) {
                runCatching { service.contentResolver.delete(mediaUri, null, null) }
            }
        }
    }

    private suspend fun ensureExchangePrivacy(initialRoot: AccessibilityNodeInfo): Boolean {
        var root = initialRoot
        var privacy = findExchangePrivacyCheck(root)
        if (privacy != null && SoulExchangePolicy.isPrivacyEnabled(privacy.text, privacy.isChecked)) {
            return true
        }
        if (privacy == null || !tapNode(privacy)) return false

        delay(700)
        root = service.rootInActiveWindow ?: return false
        privacy = findExchangePrivacyCheck(root)
        if (privacy != null && SoulExchangePolicy.isPrivacyEnabled(privacy.text, privacy.isChecked)) {
            return true
        }

        val toggle = findExchangePrivacySwitch(root) ?: return false
        if (!tapNode(toggle)) return false
        delay(700)

        root = service.rootInActiveWindow ?: return false
        if (findExchangePrivacySwitch(root) != null) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(600)
            root = service.rootInActiveWindow ?: root
        }
        privacy = findExchangePrivacyCheck(root)
        return privacy != null && SoulExchangePolicy.isPrivacyEnabled(privacy.text, privacy.isChecked)
    }

    private suspend fun submitExchange(previewRoot: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val freshPreview = service.rootInActiveWindow ?: previewRoot
        val submit = findVisibleNodeWithText(freshPreview, SoulExchangePolicy.EXCHANGE_LABEL)
        if (submit != null) tapNode(submit)
        waitForRoot(4, 650) { isInChat(it) }?.let { return it }

        val point = SoulExchangePolicy.fallbackSubmitPoint(
            screenWidth = service.resources.displayMetrics.widthPixels,
            screenHeight = service.resources.displayMetrics.heightPixels
        )
        android.util.Log.w("AIA", "Soul exchange submit fallback x=${point.x} y=${point.y}")
        if (!performTap(point.x.toFloat(), point.y.toFloat())) return null
        return waitForRoot(8, 700) { isInChat(it) }
    }

    private fun findExchangeEntryNode(item: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        for (target in EXCHANGE_ENTRY_IDS) {
            item.findAccessibilityNodeInfosByViewId(prefix + target)
                .firstOrNull { it.isVisibleToUser }
                ?.let { return actionableNode(it) }
        }
        return actionableNode(item)
    }

    private fun findFirstAlbumPhoto(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val firstMark = root.findAccessibilityNodeInfosByViewId(prefix + "fl_select_mark")
            .filter { it.isVisibleToUser }
            .minByOrNull(::photoIndex)
        if (firstMark != null) {
            return clickableAncestor(firstMark, maxDepth = 4)
                ?: firstMark.parent
                ?: firstMark
        }

        val firstImage = root.findAccessibilityNodeInfosByViewId(prefix + "iv_photo")
            .firstOrNull { it.isVisibleToUser }
            ?: return null
        return clickableAncestor(firstImage, maxDepth = 4)
            ?: firstImage.parent
            ?: firstImage
    }

    private fun photoIndex(node: AccessibilityNodeInfo): Int {
        val match = PHOTO_INDEX_PATTERN.find(node.contentDescription?.toString().orEmpty())
        return match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: Int.MAX_VALUE
    }

    private fun findIncomingImageTarget(item: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        for (target in INCOMING_IMAGE_TARGET_IDS) {
            item.findAccessibilityNodeInfosByViewId(prefix + target)
                .firstOrNull { it.isVisibleToUser }
                ?.let { return actionableNode(it) }
        }
        return null
    }

    private fun findExchangePrivacyCheck(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        return root.findAccessibilityNodeInfosByViewId(prefix + "checkSnapChat")
            .firstOrNull { it.isVisibleToUser }
    }

    private fun findExchangePrivacySwitch(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        return root.findAccessibilityNodeInfosByViewId(prefix + "switchBanScreenshotAndSave")
            .firstOrNull { it.isVisibleToUser && it.isClickable }
    }

    private fun findVisibleNodeWithText(root: AccessibilityNodeInfo, expected: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val text = node.text?.toString()?.replace(Regex("\\s+"), "").orEmpty()
            if (node.isVisibleToUser && text.contains(expected)) {
                return actionableNode(node) ?: node
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private fun containsProtectedExchange(root: AccessibilityNodeInfo): Boolean {
        return root.findAccessibilityNodeInfosByViewId(prefix + "item_roote_snap_exchange_photo")
            .asReversed()
            .filter { it.isVisibleToUser }
            .any { item ->
                val status = item.findAccessibilityNodeInfosByViewId(prefix + "tv_status")
                    .firstOrNull()
                    ?.text
                val tag = item.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag")
                    .firstOrNull()
                    ?.text
                SoulExchangePolicy.isProtectedMessage(status, tag)
            }
    }

    private fun isExchangeItem(item: AccessibilityNodeInfo): Boolean {
        val description = item.findAccessibilityNodeInfosByViewId(prefix + "chat_exchange_desc")
            .firstOrNull()
            ?.text
        if (SoulExchangePolicy.isExchangeLabel(description)) return true
        return item.findAccessibilityNodeInfosByViewId(prefix + "chat_exchange_change").isNotEmpty()
    }

    private fun isAlbumPicker(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName && (
            root.findAccessibilityNodeInfosByViewId(prefix + "rvAlbum").isNotEmpty() ||
                root.findAccessibilityNodeInfosByViewId(prefix + "tv_photo_folder").isNotEmpty()
            )
    }

    private fun isExchangePreview(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName &&
            root.findAccessibilityNodeInfosByViewId(prefix + "checkSnapChat").isNotEmpty() &&
            root.findAccessibilityNodeInfosByViewId(prefix + "tv_photo4photo_preview").isNotEmpty()
    }

    private fun isImagePreview(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName &&
            root.findAccessibilityNodeInfosByViewId(prefix + "preview_vp").isNotEmpty()
    }

    private fun clickableAncestor(node: AccessibilityNodeInfo, maxDepth: Int): AccessibilityNodeInfo? {
        var current = node.parent
        repeat(maxDepth) {
            val candidate = current ?: return null
            if (candidate.isClickable && candidate.isVisibleToUser) return candidate
            current = candidate.parent
        }
        return null
    }

    private suspend fun waitForRoot(
        attempts: Int,
        intervalMs: Long,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        repeat(attempts) { attempt ->
            if (attempt > 0) delay(intervalMs)
            if (!automationMayContinue()) return null
            val root = service.rootInActiveWindow ?: return@repeat
            if (predicate(root)) return root
        }
        return null
    }

    private suspend fun recoverToChat() {
        repeat(3) {
            val root = service.rootInActiveWindow
            when {
                root == null -> delay(500)
                isInChat(root) -> return
                root.packageName?.toString() != packageName -> bringToForeground(service)
                else -> service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            }
            delay(500)
        }
    }

    private fun automationMayContinue(): Boolean {
        return !GestureMonitor.isUserTouchingRecently(USER_PAUSE_MS)
    }

    private fun findLatestIncomingVisualItem(
        root: AccessibilityNodeInfo,
        includeExchange: Boolean = true,
        targetType: String? = null
    ): AccessibilityNodeInfo? {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")
        for (item in items.asReversed()) {
            if (!item.isVisibleToUser) continue
            if (isInsideTransientOverlay(item)) continue
            if (item.findAccessibilityNodeInfosByViewId(prefix + "aigcRootView").isNotEmpty()) continue
            val hasSnapPhoto = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_receive_root").isNotEmpty()
            val hasSnapExchange = item.findAccessibilityNodeInfosByViewId(prefix + "item_roote_snap_exchange_photo").isNotEmpty()
            val hasPrivacyTag = item.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag").isNotEmpty()
            if (SoulExchangePolicy.shouldSkipPrivacyShell(
                    hasPrivacyTag = hasPrivacyTag,
                    hasSnapPhotoReceiveRoot = hasSnapPhoto,
                    hasSnapExchangeRoot = hasSnapExchange
                )
            ) {
                continue
            }
            if (readMessageSender(item, service.resources.displayMetrics.widthPixels) == "self") continue
            if (!includeExchange && isExchangeItem(item)) continue

            if (matchesVisualTarget(item, targetType)) return item
        }
        return null
    }

    private fun matchesVisualTarget(item: AccessibilityNodeInfo, targetType: String?): Boolean {
        if (targetType == "exchange") return isExchangeItem(item)
        if (targetType == "image" && isExchangeItem(item)) return false
        // 卡片必须精确命中 cardRoot，否则聊天页里别的图片会把它顶掉、截错东西。
        if (targetType == SoulMomentCard.TYPE) {
            return item.findAccessibilityNodeInfosByViewId(prefix + "cardRoot").isNotEmpty()
        }
        return isExchangeItem(item) || hasAnyVisibleId(item, targetIdsFor(targetType))
    }

    private fun targetIdsFor(targetType: String?): List<String> {
        return when (targetType) {
            "image" -> IMAGE_TARGET_IDS
            "voice" -> VOICE_TARGET_IDS
            "voice_emoji" -> emptyList()
            // 转发动态卡片：只截卡片里的配图，不要把作者和正文一起截进去
            // （文字是从节点直接读的，比让视觉模型认字准）。
            SoulMomentCard.TYPE -> MOMENT_CARD_IMAGE_IDS
            else -> VISUAL_TARGET_IDS
        }
    }

    private fun hasAnyVisibleId(item: AccessibilityNodeInfo, targetIds: List<String>): Boolean {
        return targetIds.any { target ->
            item.findAccessibilityNodeInfosByViewId(prefix + target).any { it.isVisibleToUser }
        }
    }

    private fun isPrivacyPreview(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName && (
            root.findAccessibilityNodeInfosByViewId(prefix + "snap_chat_view").isNotEmpty() ||
                root.findAccessibilityNodeInfosByViewId(prefix + "preview_vp").isNotEmpty()
            )
    }

    private fun fallbackReadTextViews(
        node: AccessibilityNodeInfo,
        messages: MutableList<ChatMessage>,
        screenWidth: Int
    ) {
        if (isInsideTransientOverlay(node)) return
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (SoulViewportPolicy.isMessageVisible(
                        top = rect.top,
                        bottom = rect.bottom,
                        screenHeight = service.resources.displayMetrics.heightPixels
                    )
                ) {
                    val sender = if (rect.left > screenWidth / 2) "self" else "other"
                    messages.add(
                        ChatMessage(
                            sender = sender,
                            content = text,
                            identityKey = SoulMessageIdentity.key(
                                sender = sender,
                                type = "text",
                                content = text,
                            )
                        )
                    )
                }
            }
        }
        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { fallbackReadTextViews(it, messages, screenWidth) }
        }
    }

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?
    ): SendResult = fillAndSend(service, root, text, expectedContactName, canProceed = { true })

    override suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String,
        expectedContactName: String?,
        canProceed: () -> Boolean
    ): SendResult {
        if (!canProceed()) return SendResult.STOPPED
        val currentRoot = waitForVerifiedChatRoot(expectedContactName)
            ?: run {
                android.util.Log.w("AIA", "Soul send blocked: chat/title not verified, expected=$expectedContactName")
                return SendResult.NOT_VERIFIED
            }

        val beforeMessages = readMessages(currentRoot)
        // 2026-10-07 真机：上一次其实发出去了、只是没验证到，几秒后待处理回复又发一遍 → 同一句重复。
        // 发之前先看最近两条自己发的话里有没有这一句；有就当成已发送，不再发。
        if (com.aaiagent.engine.OutgoingEchoPolicy.alreadyJustSent(
                text = text,
                recentSelfMessages = beforeMessages.filter { it.sender == "self" }.map { it.content },
            )
        ) {
            android.util.Log.w("AIA", "send skipped: identical outgoing already in chat expect=$expectedContactName")
            return SendResult.SUCCESS
        }
        findEditableInput(currentRoot) ?: return SendResult.TIMEOUT
        if (!setTextAndVerify(text, canProceed)) {
            return if (canProceed()) SendResult.NOT_VERIFIED else SendResult.STOPPED
        }

        if (!canProceed()) return SendResult.STOPPED
        waitForVerifiedChatRoot(expectedContactName) ?: return SendResult.NOT_VERIFIED

        delay(SoulSendTimingPolicy.POST_FILL_SETTLE_MS)
        if (!canProceed()) return SendResult.STOPPED
        // The accessibility tree can be rebuilt while the input settles. A
        // previously found node can then point at a different control (real
        // incident: the supposed send button became main_tab_me, so the agent
        // opened the profile/membership area). Re-find the button on the
        // current verified chat page and require its identity before tapping.
        val currentChat = waitForVerifiedChatRoot(expectedContactName)
            ?: return SendResult.NOT_VERIFIED
        val freshSendButton = currentChat
            .findAccessibilityNodeInfosByViewId(prefix + "btn_send")
            .asSequence()
            .mapNotNull(::actionableNode)
            .firstOrNull { node ->
                node.viewIdResourceName == prefix + "btn_send" && node.isVisibleToUser
            }
        val clicked = freshSendButton != null &&
            tapNode(
                freshSendButton,
                source = "send:button",
                expectedViewId = "btn_send",
            )
        if (!clicked) {
            android.util.Log.w("AIA", "send button not safely clickable; keeping chat untouched")
            return SendResult.NOT_VERIFIED
        }

        val verified = verifySent(text, canProceed)
        if (verified == SendResult.BANNED) return SendResult.BANNED
        return verified
    }

    override suspend fun sendImage(
        service: AccessibilityService,
        expectedContactName: String?,
        imageBytes: ByteArray,
        fileName: String,
        contentType: String,
        canProceed: () -> Boolean
    ): SendResult {
        if (!canProceed() || imageBytes.isEmpty()) return SendResult.STOPPED
        val chatRoot = waitForVerifiedChatRoot(expectedContactName)
            ?: return SendResult.NOT_VERIFIED
        val beforeImageCount = outgoingImageCount(readMessages(chatRoot))
        val mediaUri = withContext(Dispatchers.IO) {
            persistOutgoingImage(imageBytes, fileName, contentType)
        } ?: return SendResult.TIMEOUT

        var sent = false
        return try {
            val albumRoot = openNativeAlbumPicker(expectedContactName, canProceed)
                ?: return SendResult.NOT_VERIFIED
            if (!selectNewestAlbumPhoto(albumRoot, canProceed)) return SendResult.TIMEOUT
            val result = verifyImageSent(beforeImageCount, canProceed)
            sent = result == SendResult.SUCCESS
            result
        } finally {
            // 2026-10-05 真机：媒体面板/相册自带全屏遮罩，发图流程任何一步失败都不关的话，
            // 遮罩会一直盖在聊天页上（用户看到“Soul 上多了一层阴影”）。失败时一定退回聊天页。
            if (!sent) closeMediaFlow(expectedContactName)
            if (sent) delay(1_500)
            withContext(Dispatchers.IO) {
                runCatching { service.contentResolver.delete(mediaUri, null, null) }
            }
        }
    }

    /**
     * 把媒体面板/相册/预览页退回到聊天页。
     * 这些界面都自带遮罩层，留在屏幕上会一直压暗并拦截点击（真机 2026-10-05 的现象）。
     */
    private suspend fun closeMediaFlow(expectedContactName: String?) {
        repeat(MEDIA_FLOW_CLOSE_ATTEMPTS) {
            val root = service.rootInActiveWindow ?: return
            if (root.packageName?.toString() != packageName) return
            val onMediaSurface = MEDIA_FLOW_IDS.any { id ->
                root.findAccessibilityNodeInfosByViewId(prefix + id).any(::isVisibleOnScreen)
            }
            val inVerifiedChat = isInChat(root) &&
                ConversationIdentity.matches(expectedContactName.orEmpty(), readChatTitle(root))
            if (!onMediaSurface && inVerifiedChat) return
            android.util.Log.w(
                "AIA",
                "close media flow back-press onMediaSurface=$onMediaSurface inVerifiedChat=$inVerifiedChat"
            )
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(600)
        }
    }

    private suspend fun openNativeAlbumPicker(
        expectedContactName: String?,
        canProceed: () -> Boolean
    ): AccessibilityNodeInfo? {
        if (!canProceed()) return null
        var root = waitForVerifiedChatRoot(expectedContactName) ?: return null
        var panel = root.findAccessibilityNodeInfosByViewId(prefix + "media_menu_fragment_container")
            .firstOrNull(::isVisibleOnScreen)
        if (panel == null) {
            val more = root.findAccessibilityNodeInfosByViewId(prefix + "menu_tab_more_inner")
                .asSequence()
                .mapNotNull(::clickableNode)
                .firstOrNull(::isVisibleOnScreen)
                ?: return null
            if (!tapNode(more)) return null
            root = waitForRoot(8, 350) {
                it.findAccessibilityNodeInfosByViewId(prefix + "media_menu_fragment_container")
                    .any(::isVisibleOnScreen)
            } ?: service.rootInActiveWindow ?: return null
            panel = root.findAccessibilityNodeInfosByViewId(prefix + "media_menu_fragment_container")
                .firstOrNull(::isVisibleOnScreen)
        }
        val photoEntry = panel?.let { findVisibleNodeByText(it, "图片") }
            ?.let { node -> clickableNode(node) ?: node }
            ?: return null
        if (!tapNode(photoEntry)) return null

        val albumRoot = waitForRoot(10, 350) { candidate ->
            isAlbumPicker(candidate) ||
                candidate.findAccessibilityNodeInfosByViewId(prefix + "iv_photo").any()
        }
        if (albumRoot == null) {
            android.util.Log.w("AIA", "Soul album picker did not become accessible")
        }
        return albumRoot
    }

    private suspend fun selectNewestAlbumPhoto(
        initialRoot: AccessibilityNodeInfo,
        canProceed: () -> Boolean
    ): Boolean {
        var root = initialRoot
        var selectionAttempted = false
        var privacyEnsured = false
        repeat(12) {
            if (!canProceed()) return false
            if (privacyEnsured && isInChat(root)) {
                android.util.Log.w("AIA", "Soul album returned to chat before send was tapped")
                return false
            }
            val send = root.findAccessibilityNodeInfosByViewId(prefix + "tvSend")
                .firstOrNull { it.isEnabled }
            if (privacyEnsured) {
                if (!tapAlbumSend(send, root)) return false
                return waitForRoot(15, 500) { isInChat(it) } != null
            }
            if (!isAlbumPicker(root)) {
                delay(300)
                root = service.rootInActiveWindow ?: return false
                return@repeat
            }
            val photo = root.findAccessibilityNodeInfosByViewId(prefix + "iv_photo")
                .filter(::isVisibleOnScreen)
                .sortedWith(compareBy<AccessibilityNodeInfo> { node -> Rect().also(node::getBoundsInScreen).top }
                    .thenBy { node -> Rect().also(node::getBoundsInScreen).left })
                .firstOrNull() ?: return false
            val mark = photo.parent
                ?.findAccessibilityNodeInfosByViewId(prefix + "fl_select_mark")
                ?.firstOrNull(::isVisibleOnScreen)
            val target = SoulAlbumSelectionPolicy.chooseTapTarget(
                photo = photo,
                marker = mark,
                parentOf = { it.parent },
                isClickable = { it.isClickable },
                isVisible = ::isVisibleOnScreen
            )
            val alreadySelected = mark?.let {
                SoulAlbumSelectionPolicy.isSelectionMarkerSelected(
                    contentDescription = it.contentDescription,
                    isSelected = it.isSelected
                )
            } == true
            if (!selectionAttempted && !alreadySelected) {
                if (!tapNode(target, preferGesture = true)) return false
                selectionAttempted = true
                android.util.Log.d("AIA", "Soul album photo selected marker=${mark != null}")
                delay(700)
                root = service.rootInActiveWindow ?: return false
                return@repeat
            }

            if (!privacyEnsured) {
                privacyEnsured = ensureAlbumPrivacy(root, canProceed)
                if (!privacyEnsured) {
                    android.util.Log.w("AIA", "Soul album send blocked: privacy was not enabled")
                }
                delay(400)
                root = service.rootInActiveWindow ?: return false
                return@repeat
            }

            delay(600)
            root = service.rootInActiveWindow ?: return false
        }
        return isInChat(root)
    }

    private suspend fun ensureAlbumPrivacy(
        initialRoot: AccessibilityNodeInfo,
        canProceed: () -> Boolean
    ): Boolean {
        var root = initialRoot
        repeat(3) {
            if (!canProceed()) return false
            val privacy = findAlbumPrivacyCheck(root)
            if (privacy?.isChecked == true) {
                android.util.Log.d("AIA", "Soul album privacy verified")
                return true
            }
            if (privacy == null || !tapNode(privacy, preferGesture = true)) {
                delay(500)
                root = service.rootInActiveWindow ?: return false
                return@repeat
            }

            delay(700)
            root = service.rootInActiveWindow ?: return false
            val toggle = findExchangePrivacySwitch(root)
            if (toggle != null) {
                if (!toggle.isChecked && !tapNode(toggle, preferGesture = true)) return false
                delay(600)
            }

            root = service.rootInActiveWindow ?: return false
            if (findExchangePrivacySwitch(root) != null) {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                delay(700)
                root = service.rootInActiveWindow ?: root
            }

            repeat(4) {
                if (!canProceed()) return false
                val verified = findAlbumPrivacyCheck(root)
                if (verified?.isChecked == true) {
                    android.util.Log.d("AIA", "Soul album privacy verified")
                    return true
                }
                delay(400)
                root = service.rootInActiveWindow ?: root
            }
        }
        return false
    }

    private fun findAlbumPrivacyCheck(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        return root.findAccessibilityNodeInfosByViewId(prefix + "checkSnapChat")
            .firstOrNull { it.isEnabled }
    }

    private fun tapAlbumSend(send: AccessibilityNodeInfo?, root: AccessibilityNodeInfo): Boolean {
        val sendBounds = Rect()
        send?.getBoundsInScreen(sendBounds)
        if (send != null && sendBounds.width() > 0 && sendBounds.height() > 0) {
            android.util.Log.d("AIA", "Soul album send tap visible node bounds=$sendBounds")
            return performTap(sendBounds.centerX().toFloat(), sendBounds.centerY().toFloat())
        }
        val bottomBarBounds = root.findAccessibilityNodeInfosByViewId(prefix + "rlBottomBar")
            .firstOrNull(::isVisibleOnScreen)
            ?.let { node -> Rect().also(node::getBoundsInScreen) }
        val screenWidth = service.resources.displayMetrics.widthPixels
        val screenHeight = service.resources.displayMetrics.heightPixels
        val point = SoulAlbumSelectionPolicy.fallbackSendPoint(
            screenWidth = screenWidth,
            screenHeight = screenHeight,
            bottomBarTop = bottomBarBounds?.top,
            bottomBarRight = bottomBarBounds?.right,
            bottomBarBottom = bottomBarBounds?.bottom
        )
        android.util.Log.d(
            "AIA",
            "Soul album send tap node=${send != null} nodeBounds=$sendBounds screen=${screenWidth}x$screenHeight bottomBar=$bottomBarBounds x=${point.x} y=${point.y}"
        )
        return performTap(point.x.toFloat(), point.y.toFloat())
    }

    private suspend fun verifyImageSent(
        beforeImageCount: Int,
        canProceed: () -> Boolean
    ): SendResult {
        repeat(6) { attempt ->
            if (!canProceed()) return SendResult.STOPPED
            delay(if (attempt == 0) 800L else 600L)
            val root = service.rootInActiveWindow ?: return@repeat
            if (detectBanned(root)) return SendResult.BANNED
            if (!isInChat(root)) return@repeat
            if (outgoingImageCount(readMessages(root)) > beforeImageCount) return SendResult.SUCCESS
        }
        return SendResult.NOT_VERIFIED
    }

    private fun outgoingImageCount(messages: List<ChatMessage>): Int {
        return messages.count { message ->
            message.sender == "self" && (
                message.type == "image" ||
                    message.content.contains("[图片]") ||
                    message.content.contains("[闪照]")
                )
        }
    }

    private fun findVisibleNodeByText(root: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (isVisibleOnScreen(node) && (
                    node.text?.toString()?.trim() == text ||
                        node.contentDescription?.toString()?.trim() == text
                    )
            ) {
                return node
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private fun persistOutgoingImage(
        imageBytes: ByteArray,
        fileName: String,
        contentType: String
    ): Uri? {
        val resolver = service.contentResolver
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifBlank { "image.jpg" }
        val displayName = "aaiagent_" + System.currentTimeMillis() + "_" + safeName
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, contentType.ifBlank { "image/jpeg" })
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/AIAgent")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val uri = runCatching {
            resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        }.getOrNull() ?: return null

        return try {
            resolver.openOutputStream(uri)?.use { output -> output.write(imageBytes) } ?: return null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            }
            MediaScannerConnection.scanFile(service, arrayOf(displayName), arrayOf(contentType)) { _, _ -> }
            uri
        } catch (_: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            null
        }
    }

    suspend fun fillInputOnly(text: String, expectedContactName: String? = null): Boolean {
        if (waitForVerifiedChatRoot(expectedContactName) == null) return false
        return setTextAndVerify(text) { true }
    }

    suspend fun clearInput(): Boolean {
        val root = service.rootInActiveWindow ?: return false
        if (!isInChat(root)) return false
        val input = findEditableInput(root) ?: return false
        GestureMonitor.onAutomationActionStarted()
        try {
            input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            delay(150)
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, "")
            }
            return input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } finally {
            GestureMonitor.onAutomationActionFinished()
        }
    }

    private fun findEditableInput(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val candidates = root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage")
        for (node in candidates) {
            if (!node.isVisibleToUser) continue
            if (node.isEditable) return node
            for (index in 0 until node.childCount) {
                val child = node.getChild(index)
                if (child != null && child.isEditable && child.isVisibleToUser) return child
            }
        }
        return candidates.firstOrNull { it.isVisibleToUser }
    }

    private suspend fun setTextAndVerify(text: String, canProceed: () -> Boolean): Boolean {
        val expected = text.trim()
        if (expected.isEmpty()) return clearInput()

        repeat(3) { attempt ->
            if (!canProceed()) return false
            if (setTextDirect(expected, canProceed)) {
                android.util.Log.d("AIA", "Soul direct text succeeded attempt=${attempt + 1}")
                return true
            }

            if (!canProceed()) return false
            if (pasteIntoInput(expected, canProceed)) {
                android.util.Log.d("AIA", "Soul clipboard paste succeeded attempt=${attempt + 1}")
                return true
            }
            android.util.Log.w(
                "AIA",
                "Soul input failed attempt=${attempt + 1}, actual=${currentInputText()}"
            )
        }
        return false
    }

    private suspend fun setTextDirect(expected: String, canProceed: () -> Boolean): Boolean {
        val input = freshInputNode() ?: return false
        GestureMonitor.onAutomationActionStarted()
        try {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, expected)
            }
            input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        } finally {
            GestureMonitor.onAutomationActionFinished()
        }
        delay(350)
        return canProceed() && inputContains(expected)
    }

    private fun freshInputNode(): AccessibilityNodeInfo? {
        val root = service.rootInActiveWindow ?: return null
        root.refresh()
        return findEditableInput(root)
    }

    private fun inputContains(expected: String): Boolean {
        val actual = currentInputText() ?: return false
        return compact(actual) == compact(expected)
    }

    private fun currentInputText(): String? {
        val root = service.rootInActiveWindow ?: return null
        return root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage")
            .firstOrNull { it.isVisibleToUser }
            ?.also { it.refresh() }
            ?.text
            ?.toString()
            ?.trim()
    }

    private suspend fun pasteIntoInput(expected: String, canProceed: () -> Boolean): Boolean {
        val clipboard = service.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return false
        val previous = runCatching {
            if (clipboard.hasPrimaryClip()) clipboard.primaryClip else null
        }.getOrNull()

        return try {
            clipboard.setPrimaryClip(ClipData.newPlainText("AI托管回复", expected))
            val input = freshInputNode() ?: return false
            if (!canProceed()) return false
            GestureMonitor.onAutomationActionStarted()
            try {
                input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                if (!input.isFocused) input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                input.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            } finally {
                GestureMonitor.onAutomationActionFinished()
            }
            delay(900)
            canProceed() && inputContains(expected)
        } catch (error: Exception) {
            android.util.Log.w("AIA", "Soul clipboard paste failed", error)
            false
        } finally {
            GestureMonitor.onAutomationActionStarted()
            try {
                if (previous != null) {
                    clipboard.setPrimaryClip(previous)
                } else if (android.os.Build.VERSION.SDK_INT >= 28) {
                    clipboard.clearPrimaryClip()
                }
            } catch (_: Exception) {
            } finally {
                GestureMonitor.onAutomationActionFinished()
            }
        }
    }

    private fun actionableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(3) {
            val candidate = current ?: return null
            if (candidate.isClickable && candidate.isVisibleToUser) return candidate
            current = candidate.parent
        }
        return node.takeIf { it.isVisibleToUser }
    }

    private suspend fun verifySent(
        text: String,
        canProceed: () -> Boolean
    ): SendResult {
        repeat(3) { attempt ->
            if (!canProceed()) return SendResult.STOPPED
            delay(
                if (attempt == 0) SoulSendTimingPolicy.FIRST_VERIFY_DELAY_MS
                else SoulSendTimingPolicy.RETRY_VERIFY_DELAY_MS
            )
            if (!canProceed()) return SendResult.STOPPED
            val root = service.rootInActiveWindow ?: return@repeat
            if (detectBanned(root)) return SendResult.BANNED

            val visibleMessages = readMessages(root)
            val expected = compact(text)
            val matched = visibleMessages.takeLast(8).any { compact(it.content) == expected }
            val sendButtonVisible = isSendButtonVisible(root)
            val inputCleared = SoulInputState.isCleared(
                inChat = isInChat(root),
                sendButtonVisible = sendButtonVisible,
                inputStillContainsExpected = inputContains(text)
            )
            val confirmed = ReplyDeliveryVerificationPolicy.isSendConfirmed(
                outgoingVisible = matched,
                inputCleared = inputCleared,
            )
            android.util.Log.d(
                "AIA",
                "send verify attempt=${attempt + 1} matched=$matched inputCleared=$inputCleared sendButtonVisible=$sendButtonVisible last=${visibleMessages.lastOrNull()?.content}"
            )
            if (confirmed) return SendResult.SUCCESS
        }
        return SendResult.NOT_VERIFIED
    }

    private suspend fun waitForVerifiedChatRoot(
        expectedContactName: String?,
        retries: Int = 3,
        retryDelayMs: Long = 400L
    ): AccessibilityNodeInfo? {
        repeat(retries) { attempt ->
            val root = service.rootInActiveWindow ?: return@repeat
            root.refresh()
            if (isInChat(root) && titleMatches(root, expectedContactName)) return root
            if (attempt < retries - 1) delay(retryDelayMs)
        }
        return null
    }

    private fun isSendButtonVisible(root: AccessibilityNodeInfo): Boolean {
        return root.findAccessibilityNodeInfosByViewId(prefix + "btn_send")
            .asSequence()
            .mapNotNull(::actionableNode)
            .any { it.isVisibleToUser }
    }

    private fun titleMatches(root: AccessibilityNodeInfo, expectedContactName: String?): Boolean {
        if (expectedContactName.isNullOrBlank()) return true
        val title = readChatTitle(root)
        if (ConversationIdentity.matches(expectedContactName, title)) return true
        // “正在输入”会把聊天标题临时顶掉；输入栏还在时仍算同一个人，
        // 不能让这个短暂状态触发退出或发送验证失败。
        return isInChat(root) && ChatTitlePolicy.isTransient(title)
    }

    private fun compact(value: String): String = value.replace(Regex("\\s+"), "").trim()

    private data class ConversationLockDialog(
        val unlockButton: AccessibilityNodeInfo,
        val closeButton: AccessibilityNodeInfo?,
    )

    private fun findConversationLockDialog(root: AccessibilityNodeInfo): ConversationLockDialog? {
        if (root.packageName?.toString() != packageName) return null
        val container = root.findAccessibilityNodeInfosByViewId(prefix + "dialogContainer")
            .firstOrNull(::isVisibleOnScreen)
            ?: return null
        val title = container.findAccessibilityNodeInfosByViewId(prefix + "tv_title")
            .firstOrNull(::isVisibleOnScreen)
            ?.text
            ?.toString()
        val body = container.findAccessibilityNodeInfosByViewId(prefix + "tv_text")
            .firstOrNull(::isVisibleOnScreen)
            ?.text
            ?.toString()
        val button = container.findAccessibilityNodeInfosByViewId(prefix + "tv_btn")
            .firstOrNull(::isVisibleOnScreen)
        if (!SoulConversationLockPolicy.isLockDialog(
                title = title,
                body = body,
                unlockButton = button?.text?.toString(),
            )
        ) {
            return null
        }
        val unlockButton = button?.let(::clickableNode) ?: return null
        val closeButton = root.findAccessibilityNodeInfosByViewId(prefix + "iv_close_bottom")
            .firstOrNull(::isVisibleOnScreen)
            ?.let(::clickableNode)
        return ConversationLockDialog(unlockButton, closeButton)
    }

    private fun detectBanned(root: AccessibilityNodeInfo): Boolean {
        val keywords = listOf(
            "发送失败", "已被禁言", "发言太快", "内容违规", "违规消息", "账号异常", "操作频繁",
            "请稍后再试", "已被限制", "禁止发言", "聊天功能被封", "举报处理中",
            "违反社区规定", "请遵守", "发送内容包含", "封号", "永久封禁", "临时封禁"
        )
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val text = node.text?.toString() ?: ""
            if (keywords.any(text::contains)) return true
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return false
    }

    @Suppress("UNUSED_PARAMETER")
    override suspend fun clickConversationByName(
        root: AccessibilityNodeInfo,
        contactName: String,
        shouldClick: Boolean,
        pageIndex: Int?,
        requireUnread: Boolean,
        expectedPreview: String
    ): ConversationInfo? {
        val messageRoot = activeMessageListRootOrNull() ?: return null
        return tryFindNamedConversation(
            root = messageRoot,
            expectedName = contactName,
            shouldClick = shouldClick,
            requireUnread = requireUnread,
            expectedPreview = expectedPreview,
        )
    }

    /**
     * 影子模式专用：只读当前可见页，不滚动列表。
     */
    fun scanVisibleUnreadConversations(maxEntries: Int): List<ConversationInfo> {
        if (maxEntries <= 0) return emptyList()
        val messageRoot = activeMessageListRootOrNull() ?: return emptyList()
        return collectVisibleUnreadRows(messageRoot, maxEntries)
    }

    private fun collectVisibleUnreadRows(
        root: AccessibilityNodeInfo,
        limit: Int,
    ): List<ConversationInfo> {
        return collectConversationRows(
            root = root,
            limit = limit,
            pageIndex = 0,
            isCurrentPage = true,
            unreadOnly = true,
        )
    }


    private fun collectConversationRows(
        root: AccessibilityNodeInfo,
        limit: Int,
        pageIndex: Int,
        isCurrentPage: Boolean,
        unreadOnly: Boolean,
    ): List<ConversationInfo> {
        if (root.packageName?.toString() != packageName || limit <= 0) return emptyList()
        val rows = mutableListOf<ConversationInfo>()
        for (item in root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .filter(::isVisibleOnScreen)
        ) {
            if (rows.size >= limit) break
            val hasUnread = item.findAccessibilityNodeInfosByViewId(prefix + "unread_msg_number")
                .any(::badgeHasUnread)
            if (unreadOnly && !SoulConversationScanPolicy.shouldScheduleConversation(hasUnread)) continue
            val name = readChildText(item, "name")
                ?.let(ChatTitlePolicy::sanitize)
                ?.takeIf(String::isNotBlank)
                ?: continue
            val originLabel = item.findAccessibilityNodeInfosByViewId(prefix + "tv_from")
                .firstOrNull()
                ?.text
                ?.toString()
                .orEmpty()
            val hasSoulmateMarker = item
                .findAccessibilityNodeInfosByViewId(prefix + "conversation_soulmate_mate_imageview")
                .isNotEmpty()
            val timeText = item.findAccessibilityNodeInfosByViewId(prefix + "time").firstOrNull()?.text?.toString().orEmpty()
            rows += ConversationInfo(
                contactId = name,
                contactName = name,
                preview = readChildText(item, "message") ?: "",
                hasUnread = hasUnread,
                pageIndex = pageIndex,
                isCurrentPage = isCurrentPage,
                relationshipOrigin = SoulConversationStagePolicy.classifyListOrigin(
                    originLabel = originLabel,
                    hasSoulmateMarker = hasSoulmateMarker,
                ),
                lastMessageTime = timeText,
            )
        }
        return rows
    }

    private fun tryFindNamedConversation(
        root: AccessibilityNodeInfo,
        expectedName: String,
        shouldClick: Boolean,
        requireUnread: Boolean,
        expectedPreview: String = "",
    ): ConversationInfo? {
        if (!isInMessageList(root)) return null
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .filter(::isVisibleOnScreen)
        for (item in items) {
            val name = readChildText(item, "name") ?: continue
            if (!ConversationIdentity.matches(expectedName, name)) continue
            val preview = readChildText(item, "message") ?: ""
            if (expectedPreview.isNotBlank() && preview.isNotBlank()) {
                val cleanExpected = expectedPreview.trim()
                val cleanActual = preview.trim()
                if (cleanExpected != cleanActual &&
                    !cleanActual.contains(cleanExpected.take(8)) &&
                    !cleanExpected.contains(cleanActual.take(8))
                ) {
                    continue
                }
            }
            val hasUnread = item.findAccessibilityNodeInfosByViewId(prefix + "unread_msg_number")
                .any(::badgeHasUnread)
            if (!SoulConversationScanPolicy.canOpenConversation(hasUnread, requireUnread)) continue
            val originLabel = item.findAccessibilityNodeInfosByViewId(prefix + "tv_from")
                .firstOrNull()
                ?.text
                ?.toString()
                .orEmpty()
            val hasSoulmateMarker = item
                .findAccessibilityNodeInfosByViewId(prefix + "conversation_soulmate_mate_imageview")
                .isNotEmpty()
            val target = clickableNode(item) ?: item
            val tapSucceeded = !shouldClick || tapNode(target, source = "list:conversation")
            if (!SoulConversationScanPolicy.canReportConversationOpen(shouldClick, tapSucceeded)) continue
            return ConversationInfo(
                contactId = name,
                contactName = name,
                preview = preview,
                hasUnread = hasUnread,
                relationshipOrigin = SoulConversationStagePolicy.classifyListOrigin(
                    originLabel = originLabel,
                    hasSoulmateMarker = hasSoulmateMarker,
                ),
            )
        }
        return null
    }

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean,
        contactFilter: suspend (contactName: String, contactId: String) -> Boolean
    ): ConversationInfo? {
        val messageRoot = activeMessageListRootOrNull() ?: return null
        val rows = collectConversationRows(
            root = messageRoot,
            limit = Int.MAX_VALUE,
            pageIndex = 0,
            isCurrentPage = true,
            unreadOnly = true,
        )
        for (row in rows) {
            if (!contactFilter(row.contactName, row.contactId)) continue
            val opened = tryFindNamedConversation(
                root = messageRoot,
                expectedName = row.contactName,
                shouldClick = shouldClick,
                requireUnread = true,
            )
            if (opened != null) {
                emptyScanStreak = 0
                return opened
            }
        }
        emptyScanStreak = 0
        return null
    }

    override fun visibleUnreadCount(root: AccessibilityNodeInfo): Int {
        return collectConversationRows(
            root = root,
            limit = Int.MAX_VALUE,
            pageIndex = 0,
            isCurrentPage = true,
            unreadOnly = true,
        ).size
    }

    private fun badgeHasUnread(badge: AccessibilityNodeInfo): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(badge)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (UnreadBadgeState.isUnread(
                    text = node.text?.toString(),
                    description = node.contentDescription?.toString(),
                    visible = isVisibleOnScreen(node),
                )
            ) {
                return true
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return false
    }


    fun hasTabUnread(root: AccessibilityNodeInfo): Boolean {
        if (root.packageName?.toString() != packageName) return false
        val badge = root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg_red_dot").firstOrNull()
        if (badge != null) {
            val count = badge.text?.toString()?.trim()?.toIntOrNull() ?: 0
            if (count > 0) return true
        }
        val tab = root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg").firstOrNull()
        val desc = tab?.contentDescription?.toString().orEmpty()
        return desc.contains("未读")
    }

    fun scrollMessageListDown(root: AccessibilityNodeInfo): Boolean {
        if (!isInMessageList(root)) return false
        val recycler = root.findAccessibilityNodeInfosByViewId(prefix + "recycler_view").firstOrNull()
        if (recycler != null && recycler.isScrollable) {
            return recycler.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        }
        return swipeListVertical(scrollDown = true)
    }

    fun scrollMessageListToTop(root: AccessibilityNodeInfo): Boolean {
        if (!isInMessageList(root)) return false
        val recycler = root.findAccessibilityNodeInfosByViewId(prefix + "recycler_view").firstOrNull()
        if (recycler != null && recycler.isScrollable) {
            return recycler.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
        }
        return swipeListVertical(scrollDown = false)
    }

    private fun swipeListVertical(scrollDown: Boolean): Boolean {
        val width = service.resources.displayMetrics.widthPixels
        val height = service.resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return false
        val x = width / 2f
        val startY = if (scrollDown) height * 0.75f else height * 0.35f
        val endY = if (scrollDown) height * 0.35f else height * 0.75f
        val path = Path().apply {
            moveTo(x, startY)
            lineTo(x, endY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 200L))
            .build()
        GestureMonitor.onAutomationActionStarted()
        val ok = service.dispatchGesture(gesture, null, null)
        GestureMonitor.onAutomationActionFinished()
        return ok
    }

    private fun activeMessageListRootOrNull(): AccessibilityNodeInfo? {
        val activeRoot = service.rootInActiveWindow ?: return null
        if (activeRoot.packageName?.toString() != packageName) return null
        return activeRoot.takeIf(::isInMessageList)
    }

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo): Boolean {
        if (isInMessageList(root)) return true

        var current = root
        var unknownPageWaitCount = 0
        repeat(NAVIGATION_ATTEMPTS) { attempt ->
            val fresh = service.rootInActiveWindow ?: current
            val topChatTab = findTopChatTabState(fresh)
            val messageTab = findMessageTab(fresh)
            val splashSkip = findSplashSkip(fresh)
            val secondaryBack = findSecondaryBack(fresh)
            val pageObservation = observePage(fresh)
            val inMessageList = pageObservation.isMessageList
            val mainTabVisible = findMainBottomTabBar(fresh) != null
            val commercePage = !inMessageList &&
                !isInChat(fresh) &&
                SoulNavigationPolicy.isCommercePage(visibleTexts(fresh))
            if (commercePage) {
                android.util.Log.w("AIA", "nav COMMERCE-PAGE detected; backing out without tapping")
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                delay(650)
                return@repeat
            }
            // A visible bottom bar means the chat slot exists even when its own
            // node is unreachable, so navigation may still tap for it.
            val hasMessageTab = messageTab != null || mainTabVisible
            val action = SoulNavigationPolicy.decide(
                isInMessageList = inMessageList,
                hasMessageTab = hasMessageTab,
                hasSplashSkip = splashSkip != null,
                isInChat = isInChat(fresh),
                hasTopChatTab = topChatTab != null,
                topChatTabSelected = topChatTab?.selected == true,
                hasSecondaryBack = secondaryBack != null,
                isPublishPage = isPublishPage(fresh),
                isProfilePage = pageObservation.isProfile,
                unknownPageWaitCount = unknownPageWaitCount,
                isMainTabPage = mainTabVisible,
            )
            // 2026-10-07 用户指正：他看到的是**真正的个人资料页**（顶部返回+名字、匹配度、关注/被关注/礼物、
            // 展品馆、瞬间/收藏、底部“关注/私聊”，而且**没有输入框**）。结构 id 真机抓的是：
            //   user_match / user_match_text（匹配度）、titlebar_text_tv（顶部名字，注意与聊天页 tv_title 不同）、
            //   collect_level_text（Ta的展品馆）、tv_chat_secret（私聊）、tv_follow（关注）。
            // 用它当判别：有资料页专属 id 且没有聊天输入框/聊天标题。
            val chatNow = pageObservation.isChat
            val looksLikeProfilePage = pageObservation.isProfile
            if (looksLikeProfilePage) {
                android.util.Log.w(
                    "AIA",
                    "nav PROFILE-PAGE detected name=${pageObservation.contactName} " +
                        "reason=${pageObservation.reason}"
                )
            }
            android.util.Log.d(
                "AIA",
                "nav action=$action attempt=${attempt + 1} inList=$inMessageList " +
                    "msgTab=${messageTab != null} mainTab=$mainTabVisible " +
                    "realH=${realScreenHeight()} appH=${service.resources.displayMetrics.heightPixels} " +
                    "topTab=${topChatTab != null}/${topChatTab?.selected == true} " +
                    "chat=$chatNow waits=$unknownPageWaitCount " +
                    "window=${currentWindowClassName} profilePage=$looksLikeProfilePage"
            )
            // 已经认得出页面（消息列表或聊天页）就说明离开成功了，连续返回计数归零。
            if (inMessageList || isInChat(fresh)) secondaryBackTapStreak = 0
            when (action) {
                SoulNavigationAction.NONE -> {
                    waitForMessageList()?.let { return true }
                }
                SoulNavigationAction.TAP_SPLASH_SKIP -> {
                    unknownPageWaitCount = 0
                    tapNode(splashSkip!!, preferGesture = true, source = "nav:splashSkip")
                    delay(800)
                }
                SoulNavigationAction.TAP_SECONDARY_BACK -> {
                    unknownPageWaitCount = 0
                    // 2026-10-07 用户实测 + 真机日志：左上角那一带“未读角标”能回列表，但“头像/主页”100% 进资料页；
                    // 而聊天页里发消息的同一秒就会被判成“未知页”（输入框和消息项短暂不在树里）。
                    // 所以这里**彻底不点任何节点**了：
                    //   第 1 次 → 系统返回键；第 2 次起 → 左边缘返回手势（坐标从屏幕最左侧起，物理上碰不到头像）。
                    secondaryBackTapStreak += 1
                    if (SecondaryBackTapPolicy.shouldUseBackGesture(secondaryBackTapStreak)) {
                        swipeBackFromLeftEdge()
                    } else {
                        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    }
                    delay(650)
                }
                SoulNavigationAction.TAP_TOP_CHAT_TAB -> {
                    unknownPageWaitCount = 0
                    val target = service.rootInActiveWindow
                        ?.let(::findTopChatTabState)
                        ?.takeIf { !it.selected }
                        ?.node
                    if (target == null || !tapNode(target, source = "nav:topChatTab")) return@repeat
                    waitForMessageList()?.let { return true }
                }
                SoulNavigationAction.TAP_MESSAGE_TAB -> {
                    unknownPageWaitCount = 0
                    val liveRoot = service.rootInActiveWindow ?: fresh
                    val beforeSnapshot = listSnapshot(liveRoot)
                    val target = findMessageTab(liveRoot)
                    if (target != null &&
                        tapNode(
                            target,
                            source = "nav:messageTab",
                            expectedViewId = "main_tab_msg",
                        )
                    ) {
                        waitForMessageList()?.let { return true }
                    }
                    // Soul reports the bottom bar as a thin strip inside the app
                    // area, so a node tap can land above the real tab row. Anchor
                    // the fallback to the physical screen instead.
                    if (tapMessageTabByGeometry()) {
                        waitForMessageList()?.let { return true }
                    }
                    val afterRoot = service.rootInActiveWindow ?: liveRoot
                    if (listSnapshot(afterRoot) == beforeSnapshot) {
                        android.util.Log.d(
                            "AIA",
                            "message tab tap made no visible list change; stop retrying navigation",
                        )
                        return false
                    }
                }
                SoulNavigationAction.BACK -> {
                    unknownPageWaitCount = 0
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    delay(500)
                }
                SoulNavigationAction.WAIT -> {
                    unknownPageWaitCount++
                    delay(700)
                }
            }
            current = service.rootInActiveWindow ?: current
        }
        return false
    }


    private fun findSecondaryBack(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        // 聊天页左上角的未读角标会盖在“返回”上面，这种节点一律不用。
        val badgeRects = SECONDARY_BACK_BLOCKER_IDS.mapNotNull { id ->
            root.findAccessibilityNodeInfosByViewId(prefix + id)
                .firstOrNull(::isVisibleOnScreen)
                ?.let { node -> Rect().also(node::getBoundsInScreen) }
        }
        for (id in SECONDARY_BACK_IDS) {
            root.findAccessibilityNodeInfosByViewId(prefix + id)
                .firstOrNull(::isVisibleOnScreen)
                ?.let { node ->
                    val rect = Rect()
                    node.getBoundsInScreen(rect)
                    if (badgeRects.none { badge ->
                            SecondaryBackTapPolicy.overlaps(
                                aLeft = rect.left, aTop = rect.top, aRight = rect.right, aBottom = rect.bottom,
                                bLeft = badge.left, bTop = badge.top, bRight = badge.right, bBottom = badge.bottom,
                            )
                        }
                    ) {
                        return clickableNode(node)
                    }
                }
        }

        val screenWidth = service.resources.displayMetrics.widthPixels
        val screenHeight = service.resources.displayMetrics.heightPixels
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val label = node.contentDescription?.toString()?.trim().orEmpty()
            val isBack = label == "\u8fd4\u56de"
            val isTopLeft = bounds.top < screenHeight / 3 && bounds.centerX() < screenWidth / 3
            // 2026-10-07：这一轮以前没有重叠校验，所以可能把被未读角标盖住的节点返回出去。现在补上。
            val blockedByBadge = badgeRects.any { badge ->
                SecondaryBackTapPolicy.overlaps(
                    aLeft = bounds.left, aTop = bounds.top, aRight = bounds.right, aBottom = bounds.bottom,
                    bLeft = badge.left, bTop = badge.top, bRight = badge.right, bBottom = badge.bottom,
                )
            }
            if (isBack && isTopLeft && !blockedByBadge && isVisibleOnScreen(node)) {
                clickableNode(node)?.let { return it }
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private fun findMainBottomTabBar(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        return root.findAccessibilityNodeInfosByViewId(prefix + "main_bottom_tab_bar")
            .firstOrNull(::isVisibleOnScreen)
    }

    private fun visibleTexts(root: AccessibilityNodeInfo): List<String> {
        val values = mutableListOf<String>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (isVisibleOnScreen(node)) {
                node.text?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let(values::add)
                node.contentDescription?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let(values::add)
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return values
    }

    /**
     * Last resort for the message tab: Soul's bottom bar is a fixed five slot
     * row (星球/广场/发布/聊天/我), so the chat slot sits at 70% of the bar width.
     */
    private suspend fun tapMessageTabByGeometry(): Boolean {
        val liveRoot = service.rootInActiveWindow ?: return false
        val liveTab = liveRoot.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
            .firstOrNull { isVisibleOnScreen(it) && isSafeBottomNavigation(it) }
        if (liveTab != null) {
            val liveBounds = Rect()
            liveTab.getBoundsInScreen(liveBounds)
            if (SoulTapPolicy.isNavigationTapSafe(
                    x = liveBounds.centerX(),
                    y = liveBounds.centerY(),
                    screenWidth = service.resources.displayMetrics.widthPixels,
                    screenHeight = service.resources.displayMetrics.heightPixels,
                )
            ) {
                return performTap(liveBounds.centerX().toFloat(), liveBounds.centerY().toFloat()) &&
                    waitForMessageList() != null
            }
        }

        val bar = findMainBottomTabBar(liveRoot) ?: return false
        val screenWidth = service.resources.displayMetrics.widthPixels
        if (screenWidth <= 0) return false
        val bounds = Rect()
        bar.getBoundsInScreen(bounds)
        if (bounds.width() <= 0 || bounds.height() <= 0) return false
        val x = bounds.left + bounds.width() * 7 / 10
        // Use the real bottom-bar bounds. Using the physical screen height can
        // land below the app window and do nothing on gesture-navigation phones.
        val y = bounds.centerY()
        val screenHeight = service.resources.displayMetrics.heightPixels
        if (!SoulTapPolicy.isNavigationTapSafe(x, y, screenWidth, screenHeight)) return false
        android.util.Log.d(
            "AIA",
            "tapping chat slot by geometry x=$x y=$y bar=$bounds appHeight=$screenHeight",
        )
        return performTap(x.toFloat(), y.toFloat()) && waitForMessageList() != null
    }

    private fun realScreenHeight(): Int {
        val fallback = service.resources.displayMetrics.heightPixels
        return try {
            val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            val display = windowManager?.defaultDisplay ?: return fallback
            val point = Point()
            @Suppress("DEPRECATION")
            display.getRealSize(point)
            if (point.y > 0) point.y else fallback
        } catch (_: Exception) {
            fallback
        }
    }

    private fun findMessageTab(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
            .asSequence()
            .mapNotNull(::clickableNode)
            .firstOrNull { isVisibleOnScreen(it) && isSafeBottomNavigation(it) }
            ?.let { return it }

        val screenHeight = service.resources.displayMetrics.heightPixels
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val label = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            val isMessageLabel = label == "聊天" || label == "消息" ||
                description.startsWith("聊天") || description.startsWith("消息")
            if (isMessageLabel && bounds.top >= screenHeight * 3 / 4) {
                clickableNode(node)
                    ?.takeIf(::isSafeBottomNavigation)
                    ?.let { return it }
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private fun isSafeBottomNavigation(node: AccessibilityNodeInfo): Boolean {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        return SoulTapPolicy.isBottomNavigationBounds(
            left = bounds.left,
            top = bounds.top,
            right = bounds.right,
            bottom = bounds.bottom,
            screenWidth = service.resources.displayMetrics.widthPixels,
            screenHeight = service.resources.displayMetrics.heightPixels
        )
    }

    private fun isPublishPage(root: AccessibilityNodeInfo): Boolean {
        val className = currentWindowClassName.lowercase()
        if (!className.contains("publishchainactivity") &&
            !className.contains("publishactivity")
        ) return false
        return root.findAccessibilityNodeInfosByViewId(prefix + "main_start_up_root")
            .none(::isVisibleOnScreen)
    }

    private fun findTopChatTabState(root: AccessibilityNodeInfo): TopChatTabState? {
        val screenHeight = service.resources.displayMetrics.heightPixels
        val identified = root.findAccessibilityNodeInfosByViewId(prefix + "tv_tab")
        val candidates = if (identified.isNotEmpty()) {
            identified
        } else {
            val collected = mutableListOf<AccessibilityNodeInfo>()
            val queue = ArrayDeque<AccessibilityNodeInfo>()
            queue.add(root)
            while (queue.isNotEmpty()) {
                val node = queue.removeFirst()
                collected += node
                for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
            }
            collected
        }
        for (node in candidates) {
            if (!isVisibleOnScreen(node)) continue
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            if (bounds.top < 0 || bounds.top >= screenHeight / 2) continue
            val label = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            val isChatTab = label == "\u804a\u5929" || label == "\u6d88\u606f" ||
                description.startsWith("\u804a\u5929") || description.startsWith("\u6d88\u606f")
            if (!isChatTab || bounds.width() <= 0 || bounds.height() <= 0) continue
            val clickable = clickableNode(node) ?: continue
            return TopChatTabState(
                node = clickable,
                selected = hasSelectedState(node) || hasSelectedState(clickable)
            )
        }
        return null
    }

    private fun findSplashSkip(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val screenWidth = service.resources.displayMetrics.widthPixels
        val screenHeight = service.resources.displayMetrics.heightPixels
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            val label = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            val isSkip = label == "跳过" || label == "跳过广告" ||
                description == "跳过" || description == "跳过广告"
            val isTopRight = bounds.top < screenHeight / 3 && bounds.centerX() > screenWidth / 2
            if (isSkip && isTopRight && node.isVisibleToUser) {
                clickableNode(node)?.let { return it }
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private suspend fun waitForMessageList(): AccessibilityNodeInfo? {
        var stableReads = 0
        repeat(12) {
            delay(400)
            val root = service.rootInActiveWindow
            if (root != null && isInMessageList(root)) {
                stableReads++
                if (stableReads >= 2) return root
            } else {
                stableReads = 0
            }
        }
        return null
    }

    private fun clickableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(4) {
            val candidate = current ?: return null
            if (candidate.isClickable && isVisibleOnScreen(candidate)) return candidate
            current = candidate.parent
        }
        return node.takeIf(::isVisibleOnScreen)
    }

    private fun isVisibleOnScreen(node: AccessibilityNodeInfo): Boolean {
        if (!node.isVisibleToUser) return false
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.width() <= 0 || bounds.height() <= 0) return false
        return Rect.intersects(
            bounds,
            Rect(
                0,
                0,
                service.resources.displayMetrics.widthPixels,
                service.resources.displayMetrics.heightPixels
            )
        )
    }

    private fun hasSelectedState(node: AccessibilityNodeInfo): Boolean {
        if (node.isSelected || node.isFocused) return true
        for (index in 0 until node.childCount) {
            val child = node.getChild(index) ?: continue
            if (hasSelectedState(child)) return true
        }
        return false
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        val intent = service.packageManager.getLaunchIntentForPackage(packageName) ?: return
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        service.startActivity(intent)
        repeat(12) {
            delay(500)
            if (service.rootInActiveWindow?.packageName?.toString() == packageName) return
        }
    }

    /** 2026-10-07：点节点时把“点在哪、点的是谁”记下来——出问题时能直接定位。 */
    private fun nodeTag(node: AccessibilityNodeInfo): String {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        val id = node.viewIdResourceName?.substringAfterLast('/').orEmpty()
        val desc = node.contentDescription?.toString()?.take(14).orEmpty()
        val text = node.text?.toString()?.take(14).orEmpty()
        return "node(id=$id desc=\"$desc\" text=\"$text\" bounds=[${rect.left},${rect.top}][${rect.right},${rect.bottom}])"
    }

    private fun logTap(source: String, via: String, x: Int?, y: Int?, node: AccessibilityNodeInfo) {
        android.util.Log.d(
            "AIA",
            "tap src=" + source.ifBlank { "unknown" } + " via=" + via +
                (if (x != null && y != null) " x=" + x + " y=" + y else " x=- y=-") + " " + nodeTag(node)
        )
    }

    /**
     * 2026-10-07：左边缘往右滑 = 系统返回手势。
     * 起点固定在屏幕最左侧 (1, 屏高一半)，所以永远不会落到左上角的头像/未读角标上。
     */
    private fun swipeBackFromLeftEdge(): Boolean {
        val width = service.resources.displayMetrics.widthPixels
        val height = service.resources.displayMetrics.heightPixels
        if (width <= 0 || height <= 0) return false
        val y = height / 2f
        val path = Path().apply {
            moveTo(1f, y)
            lineTo(width * 0.6f, y)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0L, 160L))
            .build()
        GestureMonitor.onAutomationActionStarted()
        val ok = service.dispatchGesture(gesture, null, null)
        GestureMonitor.onAutomationActionFinished()
        android.util.Log.d("AIA", "nav back-gesture src=nav:secondaryBack ok=" + ok + " y=" + y)
        return ok
    }

    private fun tapNode(
        node: AccessibilityNodeInfo,
        preferGesture: Boolean = false,
        source: String = "",
        expectedViewId: String? = null,
    ): Boolean {
        if (!expectedViewId.isNullOrBlank() && !node.isVisibleToUser) {
            android.util.Log.w("AIA", "refuse to tap invisible node source=$source")
            return false
        }
        if (!SoulTapPolicy.matchesViewId(
                actualViewId = node.viewIdResourceName,
                expectedViewId = expectedViewId,
                prefix = prefix,
            )
        ) {
            android.util.Log.w(
                "AIA",
                "refuse to tap stale node source=$source expected=$expectedViewId actual=${node.viewIdResourceName}"
            )
            AutomationTrace.recordUiAction(
                platform = "soul",
                source = source,
                action = "tap_node",
                result = "blocked_stale",
                reason = "expected=$expectedViewId actual=${node.viewIdResourceName.orEmpty()}",
            )
            return false
        }
        // 2026-10-05 真机：新联系人的聊天页顶部是一张关系卡片，卡片里的头像和“访问主页”
        // 都是可点节点，点下去就跳个人资料页并退出会话。这些入口一律不点。
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (isProfileEntryPoint(node)) {
            AutomationTrace.recordUiAction(
                platform = "soul",
                source = source,
                action = "tap_profile_entry",
                result = "blocked",
                reason = node.viewIdResourceName.orEmpty(),
            )
            android.util.Log.w(
                "AIA",
                "refuse to tap profile entry viewId=${node.viewIdResourceName} bounds=$bounds"
            )
            return false
        }
        GestureMonitor.onAutomationActionStarted()
        val clicked = !preferGesture && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (clicked) {
            GestureMonitor.onAutomationActionFinished()
            logTap(source, "click", bounds.centerX(), bounds.centerY(), node)
            AutomationTrace.recordUiAction(
                platform = "soul",
                source = source,
                action = "tap_node",
                result = "clicked",
                reason = node.viewIdResourceName.orEmpty(),
            )
            return true
        }
        val point = if (bounds.width() > 0 && bounds.height() > 0) {
            SoulTapPolicy.clampPoint(
                x = bounds.centerX(),
                y = bounds.centerY(),
                screenWidth = service.resources.displayMetrics.widthPixels,
                screenHeight = service.resources.displayMetrics.heightPixels
            )
        } else {
            null
        }
        val result = point?.let { performTap(it.x.toFloat(), it.y.toFloat()) } ?: false
        GestureMonitor.onAutomationActionFinished()
        logTap(source, if (point == null) "gesture-skip" else "gesture", point?.x, point?.y, node)
        AutomationTrace.recordUiAction(
            platform = "soul",
            source = source,
            action = "tap_node",
            result = if (result) "gesture" else "failed",
            reason = node.viewIdResourceName.orEmpty(),
        )
        return result
    }

    /** 2026-10-07：每次坐标点击都记一条，并带上“是谁调的”，避免再有看不到的黑洞。 */
    private fun logCoordinateTap(x: Float, y: Float, kind: String) {
        val caller = Throwable().stackTrace.firstOrNull { frame ->
            frame.className.contains("SoulAdapter") &&
                frame.methodName != "performTap" &&
                frame.methodName != "logCoordinateTap"
        }?.methodName.orEmpty()
        android.util.Log.d(
            "AIA",
            "tap src=coord:" + caller.ifBlank { "?" } + " via=" + kind +
                " x=" + x.toInt() + " y=" + y.toInt()
        )
    }

    private fun performTap(x: Float, y: Float): Boolean {
        logCoordinateTap(x, y, "gesture")
        GestureMonitor.onAutomationActionStarted()
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 0L, 1L))
            .build()
        val result = service.dispatchGesture(gesture, null, null)
        GestureMonitor.onAutomationActionFinished()
        AutomationTrace.recordUiAction(
            platform = "soul",
            source = "coordinate:${x.toInt()},${y.toInt()}",
            action = "coordinate_tap",
            result = if (result) "dispatched" else "failed",
        )
        return result
    }

    private fun collectClickableNodes(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>) {
        if (node.isClickable && isVisibleOnScreen(node)) results.add(node)
        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { collectClickableNodes(it, results) }
        }
    }

    private fun findAncestorByViewId(node: AccessibilityNodeInfo, targetId: String): AccessibilityNodeInfo? {
        return SoulNodeHierarchy.findIncludingSelf(
            start = node,
            parentOf = { it.parent },
            viewIdOf = { it.viewIdResourceName },
            targetViewId = prefix + targetId
        )
    }
    private fun hasAnyVisibleViewId(
        item: AccessibilityNodeInfo,
        ids: List<String>
    ): Boolean {
        return ids.any { id ->
            item.findAccessibilityNodeInfosByViewId(prefix + id).any { it.isVisibleToUser }
        }
    }

    private fun hasDescendantViewIdFragment(
        item: AccessibilityNodeInfo,
        fragments: List<String>
    ): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(item)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isVisibleToUser) {
                val id = node.viewIdResourceName?.substringAfterLast('/')?.lowercase().orEmpty()
                if (fragments.any(id::contains)) return true
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return false
    }

    private fun hasDescendantContentDescription(
        item: AccessibilityNodeInfo,
        expected: List<String>
    ): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(item)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            if (node.isVisibleToUser && node.className?.toString()?.contains("ImageView") == true &&
                expected.any(description::contains)
            ) {
                return true
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return false
    }

    /** 这条气泡有没有可用于判断收发方向的信号（头像或已读回执）。 */
    private fun senderSignalsMissing(item: AccessibilityNodeInfo): Boolean {
        if (item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()) return false
        if (item.findAccessibilityNodeInfosByViewId(prefix + "otherAvatar").isNotEmpty()) return false
        if (item.findAccessibilityNodeInfosByViewId(prefix + "message_read").isNotEmpty()) return false
        return item.findAccessibilityNodeInfosByViewId(prefix + "chat_avatar").isEmpty()
    }

    private fun readMessageSender(item: AccessibilityNodeInfo, screenWidth: Int): String {
        val isSentSnap = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_sender_root").isNotEmpty()
        val isReceivedSnap = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_receive_root").isNotEmpty()
        val hasSelfAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()
        val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "otherAvatar").isNotEmpty()
        val hasReadReceipt = item.findAccessibilityNodeInfosByViewId(prefix + "message_read").isNotEmpty()
        val avatarCenterX = centerX(item.findAccessibilityNodeInfosByViewId(prefix + "chat_avatar").firstOrNull())
        // 2026-10-06 真机（她自己的语音/表情）：这类媒体气泡没有已读标记、也没有闪照根节点，
        // 只剩头像一条线索；一旦连发把头像隐藏了，就会默认判成“对方发的”而回自己的消息。
        // 所以文字容器没有时，用媒体气泡自身的左右位置兜底。
        val contentCenterX = centerX(item.findAccessibilityNodeInfosByViewId(prefix + "content_text_container").firstOrNull())
            ?: MEDIA_BUBBLE_IDS.firstNotNullOfOrNull { id ->
                centerX(item.findAccessibilityNodeInfosByViewId(prefix + id).firstOrNull())
            }
        return SoulMessageDirection.resolve(
            isSelfAvatar = hasSelfAvatar,
            isOtherAvatar = hasOtherAvatar,
            hasReadReceipt = hasReadReceipt,
            avatarCenterX = avatarCenterX,
            contentCenterX = contentCenterX,
            screenWidth = screenWidth,
            isSentSnap = isSentSnap,
            isReceivedSnap = isReceivedSnap,
        )
    }

    private fun centerX(node: AccessibilityNodeInfo?): Int? {
        val target = node ?: return null
        val bounds = Rect()
        target.getBoundsInScreen(bounds)
        return if (bounds.width() > 0) bounds.centerX() else null
    }

    /**
     * 读「转发动态」卡片上的作者和正文。
     *
     * 只认 `cardRoot` 这个结构，读不到就返回 null（那条消息会退回成普通图片，不会报错）。
     * 不做任何匹配或推断——是不是"我自己的动态"交给模型结合账号昵称去认。
     */
    private fun readMomentCardContent(
        item: AccessibilityNodeInfo,
        forwardedByOther: Boolean
    ): String? {
        val cardRoot = item.findAccessibilityNodeInfosByViewId(prefix + "cardRoot")
            .firstOrNull { it.isVisibleToUser }
            ?: return null
        return SoulMomentCard.format(
            author = readChildText(cardRoot, "nickName"),
            content = readChildText(cardRoot, "content"),
            forwardedByOther = forwardedByOther
        )
    }

    private fun readQuickMenuItems(root: AccessibilityNodeInfo): List<StickerMatcher.QuickMenuItem> {
        return root.findAccessibilityNodeInfosByViewId(prefix + "cl_menu_item")
            .asSequence()
            .filter(::isVisibleOnScreen)
            .mapNotNull { item ->
                val label = item.findAccessibilityNodeInfosByViewId(prefix + "tv_menu_text")
                    .mapNotNull { it.text?.toString()?.trim() }
                    .firstOrNull { it.isNotEmpty() && it.length <= 16 }
                    ?: return@mapNotNull null
                if (!SoulGameInteraction.isGameLabel(label)) return@mapNotNull null
                val icon = item.findAccessibilityNodeInfosByViewId(prefix + "iv_menu_icon")
                    .firstOrNull(::isVisibleOnScreen)
                    ?: return@mapNotNull null
                val bounds = Rect()
                icon.getBoundsInScreen(bounds)
                if (bounds.width() <= 0 || bounds.height() <= 0) null
                else StickerMatcher.QuickMenuItem(label = label, iconBounds = bounds)
            }
            .toList()
    }

    private fun readChildText(parent: AccessibilityNodeInfo, viewId: String): String? {
        return parent.findAccessibilityNodeInfosByViewId(prefix + viewId)
            .firstOrNull { it.text?.toString()?.isNotBlank() == true }
            ?.text
            ?.toString()
            ?.trim()
    }

    private fun readSystemInteractionMessages(root: AccessibilityNodeInfo): List<LocatedMessage> {
        return root.findAccessibilityNodeInfosByViewId(prefix + "text")
            .asSequence()
            .filter { it.isVisibleToUser && !isInsideMessageItem(it) }
            .filterNot(::isInsideTransientOverlay)
            .mapNotNull { node ->
                val parsed = SoulInteractionMessage.parseSystemText(node.text?.toString().orEmpty())
                    ?: return@mapNotNull null
                val modelText = StickerMatcher.modelTextFor(parsed.displayName)
                    ?: return@mapNotNull null
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (!SoulViewportPolicy.isMessageVisible(
                        top = rect.top,
                        bottom = rect.bottom,
                        screenHeight = service.resources.displayMetrics.heightPixels
                    )
                ) return@mapNotNull null
                LocatedMessage(
                    top = rect.top,
                    message = ChatMessage(
                        sender = "other",
                        content = modelText,
                        type = "text",
                        identityKey = SoulMessageIdentity.key(
                            sender = "other",
                            type = "system_interaction",
                            content = modelText,
                        )
                    )
                )
            }
            .distinctBy { it.top to it.message.content }
            .toList()
    }

    private fun isInsideMessageItem(node: AccessibilityNodeInfo): Boolean {
        return SoulNodeHierarchy.findIncludingSelf(
            start = node,
            parentOf = { it.parent },
            viewIdOf = { it.viewIdResourceName },
            targetViewId = prefix + "item_root"
        ) != null
    }

    private fun isInsideTransientOverlay(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        while (current != null) {
            if (SoulTransientOverlayPolicy.isTransientViewId(current.viewIdResourceName)) return true
            current = current.parent
        }
        return false
    }

    private suspend fun waitForTransientOverlayToClear(
        initialRoot: AccessibilityNodeInfo,
        chatUsable: Boolean = false,
    ): AccessibilityNodeInfo {
        var current = initialRoot
        val firstOverlay = findVisibleTransientOverlay(current) ?: return current
        if (!SoulOverlayWaitPolicy.shouldWaitForClear(
                chatUsable = chatUsable,
                overlayVisible = true,
            )
        ) {
            android.util.Log.d(
                "AIA",
                "transient overlay ignored because the chat page is usable " +
                    "id=${firstOverlay.viewIdResourceName}"
            )
            return current
        }
        val startedAt = System.currentTimeMillis()
        android.util.Log.d(
            "AIA",
            "transient overlay visible id=${firstOverlay.viewIdResourceName}; waiting"
        )
        repeat(TRANSIENT_OVERLAY_WAIT_ATTEMPTS) {
            delay(TRANSIENT_OVERLAY_WAIT_DELAY_MS)
            current = service.rootInActiveWindow ?: current
            val overlay = findVisibleTransientOverlay(current)
            if (overlay == null) {
                android.util.Log.d(
                    "AIA",
                    "transient overlay cleared elapsed=${System.currentTimeMillis() - startedAt}ms"
                )
                return current
            }
        }
        android.util.Log.w(
            "AIA",
            "transient overlay still visible after=" +
                "${System.currentTimeMillis() - startedAt}ms"
        )
        return current
    }

    private fun findVisibleTransientOverlay(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isVisibleToUser &&
                SoulTransientOverlayPolicy.shouldWaitForClear(node.viewIdResourceName)
            ) {
                return node
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return null
    }

    // ------------------------------------------------------------------
    // 语音发送：点「录音」→ 等配音放完 → 点「暂停录音」→ 核对时长 → 点「发语音」
    //
    // 真机实测（2026-10-06）：Soul 自带的录音面板全程是"点一下"，不需要长时间按住，
    // 所以比"按住说话"稳得多；面板自带「取消」，异常时能体面退出。
    // 判断和顺序都在 [SoulVoiceDelivery] / [SoulVoiceRecordPolicy] 里（能脱离安卓单测），
    // 这里只负责"点哪里、读什么"。
    // ------------------------------------------------------------------

    /**
     * 让 Soul 录一段语音并发出去。[audioDurationMs] 是配音时长，[spokenText] 是这段语音实际说的话。
     *
     * 发送成功后会把"这条语音说了什么"记进 [SelfVoiceMemory]，
     * 否则之后重读聊天页只会看到一个 [语音]，大模型不知道我们说过什么。
     */
    suspend fun recordAndSendVoice(
        audioDurationMs: Long,
        spokenText: String,
        canProceed: () -> Boolean = { true },
        /** 外放模式下用：录音开始后把配音从扬声器放出来（见 SoulVoiceDelivery.recordAndSend）。 */
        playback: (() -> Unit)? = null
    ): SoulVoiceDelivery.Result {
        val result = SoulVoiceDelivery(SoulVoiceScreenImpl())
            .recordAndSend(audioDurationMs, canProceed, playback)
        if (result.status == SoulVoiceDelivery.Status.SENT) {
            SelfVoiceMemory.remember(
                conversationKey = currentChatTitle(),
                durationSeconds = result.recordedSeconds ?: 0,
                text = spokenText,
                sentAtMillis = System.currentTimeMillis()
            )
        }
        return result
    }

    /** 当前会话标题，用来把不同联系人的语音记忆分开。 */
    private fun currentChatTitle(): String {
        val root = service.rootInActiveWindow ?: return ""
        return readChatTitle(root)?.trim().orEmpty()
    }

    private inner class SoulVoiceScreenImpl : SoulVoiceDelivery.SoulVoiceScreen {

        override suspend fun openRecorder(): Boolean {
            val entry = findRecorderEntryWithVoiceMode()
            if (entry == null) {
                android.util.Log.w("AIA", "voice recorder entry not found")
                return false
            }
            return tapNode(entry)
        }

        override fun panelState(): SoulVoiceRecordPolicy.PanelState =
            SoulVoiceRecordPolicy.panelState(
                middleButtonLabel = findVisibleById(RECORDER_MIDDLE_LABEL_ID)?.text?.toString()
            )

        /**
         * 上一次点中间那个大按钮落下去的位置。
         *
         * 因为「暂停」和「发送」**是同一个按钮**，Soul 只是把节点换掉了（位置几乎不变，
         * 实测 541,2028 → 540,1998）。所以万一发送时找不到新节点，
         * 直接用这个坐标补一次，比重新找节点稳。
         */
        private var lastActionPoint: Pair<Int, Int>? = null

        /** 点中间那个大按钮（此刻它叫「暂停录音」）。 */
        override fun tapPause(): Boolean =
            tapRecorderButton(
                SoulVoiceRecordPolicy.actionButtonIds(SoulVoiceRecordPolicy.PanelState.RECORDING)
            )

        /** 点同一个按钮（此刻它叫「发语音」）。 */
        override fun tapSend(): Boolean =
            tapRecorderButton(
                SoulVoiceRecordPolicy.actionButtonIds(SoulVoiceRecordPolicy.PanelState.PAUSED)
            )

        override fun tapCancel(): Boolean {
            val cancel = findVisibleById(RECORDER_CANCEL_ID)
            if (cancel == null) {
                android.util.Log.w("AIA", "voice recorder cancel button not found")
                return false
            }
            return tapNode(cancel)
        }

        override suspend fun awaitPanelState(
            state: SoulVoiceRecordPolicy.PanelState,
            timeoutMs: Long
        ): Boolean = awaitPanel(timeoutMs) { it == state }

        override suspend fun awaitPanelClosed(timeoutMs: Long): Boolean =
            awaitPanel(timeoutMs) { it == SoulVoiceRecordPolicy.PanelState.ABSENT }

        /**
         * 中间大按钮在两个状态下节点名不同，按优先级逐个试。
         *
         * **必须用真实坐标点击（preferGesture），不能用 performAction(ACTION_CLICK)**：
         * 2026-10-06 07:00 真机，点了暂停却毫无反应（pause_not_confirmed）。
         * Android 的 ACTION_CLICK 只要控件标着 clickable 就返回成功、哪怕它根本没处理，
         * 于是代码以为点到了、就不再去试坐标点击。中间那个进度环正是这种控件。
         * 手动触摸能暂停，说明真实触摸路径是通的 —— 所以这里走坐标点击。
         *
         * 两条真机经验都落在这里：
         *
         * 1) **「暂停」和「发送」是同一个按钮**，Soul 只是把节点换掉了。所以找不到新节点时，
         *    直接复用上一次点成功的坐标 —— 位置几乎不变（实测 541,2028 → 540,1998）。
         *
         * 2) **「取消」离它只有 74 像素**（真机实测：取消右边缘 x=332，按钮左边缘 x=406）。
         *    点之前先算一遍，落进"取消 + 安全边距"的范围就干脆不点 ——
         *    宁可这次不发语音，也不能替人按了取消、把已经录好的丢掉。
         */
        private fun tapRecorderButton(ids: List<String>): Boolean {
            val cancel = findVisibleById(RECORDER_CANCEL_ID)?.let(::recorderBounds)
            for (id in ids) {
                val node = findVisibleById(id) ?: continue
                val bounds = recorderBounds(node) ?: continue
                if (!SoulVoiceRecordPolicy.isTapSafe(bounds.centerX, bounds.centerY, cancel)) {
                    android.util.Log.w(
                        "AIA",
                        "refuse to tap recorder button: too close to cancel " +
                            "id=$id center=${bounds.centerX},${bounds.centerY}"
                    )
                    continue
                }
                // 记下来：这是同一个按钮，下次找不到节点就用它。
                lastActionPoint = bounds.centerX to bounds.centerY
                if (tapNode(node, preferGesture = true)) {
                    android.util.Log.d("AIA", "voice recorder button tapped id=$id")
                    return true
                }
            }
            // 节点被换掉了但按钮还在原处 —— 用上一次的坐标补一次。
            val fallback = lastActionPoint
            if (fallback != null &&
                SoulVoiceRecordPolicy.isTapSafe(fallback.first, fallback.second, cancel)
            ) {
                android.util.Log.d(
                    "AIA",
                    "recorder button node missing; reusing last point ${fallback.first},${fallback.second}"
                )
                if (performTap(fallback.first.toFloat(), fallback.second.toFloat())) return true
            }
            android.util.Log.w("AIA", "voice recorder action button not found ids=$ids")
            return false
        }

        private fun recorderBounds(node: AccessibilityNodeInfo): SoulVoiceRecordPolicy.Bounds? {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val bounds = SoulVoiceRecordPolicy.Bounds(rect.left, rect.top, rect.right, rect.bottom)
            return bounds.takeIf { it.isUsable }
        }

        private suspend fun awaitPanel(
            timeoutMs: Long,
            accept: (SoulVoiceRecordPolicy.PanelState) -> Boolean
        ): Boolean {
            val deadline = System.currentTimeMillis() + timeoutMs
            var last = SoulVoiceRecordPolicy.PanelState.ABSENT
            while (System.currentTimeMillis() <= deadline) {
                last = panelState()
                if (accept(last)) return true
                delay(SoulVoiceRecordPolicy.WAIT_SLICE_MS)
            }
            // 到点再确认一次，避免刚好卡在边界上误判。
            last = panelState()
            if (accept(last)) return true
            // 超时一定要留下当时的原始文字，否则只能靠猜。
            // 注意别再打 tvVoiceLength —— 那是聊天记录里语音气泡的时长，和面板无关。
            android.util.Log.w(
                "AIA",
                "voice recorder panel wait timed out lastState=$last " +
                    "middleLabel=${findVisibleById(RECORDER_MIDDLE_LABEL_ID)?.text}"
            )
            return false
        }
    }

    /**
     * 把输入栏从"语音态"切回"文字态"。
     *
     * 真机事故（2026-10-06 20:00）：语音发完之后输入栏留在语音态（"按住说话"），
     * 而**整个流程里只有"切到语音态"、从来没有"切回来"** ——
     * 于是后面每一次文字回复都找不到 `et_sendmessage`（文字输入框），
     * 全部 TIMEOUT、每 5 秒重试一次变成死循环，聊天页被一直占着。
     * 用户手动点一下那个开关，循环立刻就停了 —— 反证就是这个原因。
     *
     * 已经在文字态时**绝不点开关**（免得又把状态切乱）。
     */
    suspend fun switchInputToTextMode(): Boolean {
        val root = service.rootInActiveWindow ?: return false
        if (!isInChat(root)) return false
        if (findVisibleById(TEXT_INPUT_ID) != null) return true

        val toggle = findVisibleById(RECORDER_MODE_TOGGLE_ID) ?: return false
        if (!tapNode(toggle)) return false
        android.util.Log.d("AIA", "switch input back to text mode")

        val deadline = System.currentTimeMillis() +
            SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_TIMEOUT_MS
        while (System.currentTimeMillis() <= deadline) {
            delay(SoulVoiceRecordPolicy.WAIT_SLICE_MS)
            if (findVisibleById(TEXT_INPUT_ID) != null) {
                android.util.Log.d("AIA", "input is back to text mode")
                return true
            }
        }
        android.util.Log.w("AIA", "input did not return to text mode")
        return false
    }

    /**
     * 找「录音」入口；如果当前是打字态（这个入口不存在），先把输入栏切到语音态再找。
     *
     * 真机实测（2026-10-06）：`audio_record_view_optimize` 只在**语音输入态**存在，
     * 打字态下输入栏是 `et_sendmessage` + `btn_send`。不切过去 AiaAgent 就没法自己
     * 开始录音，每次都要人先点一下。
     *
     * **只在确实找不到入口时才点切换** —— 已经在语音态时绝不会去点，免得把状态来回切。
     */
    private suspend fun findRecorderEntryWithVoiceMode(): AccessibilityNodeInfo? {
        findVisibleById(RECORDER_ENTRY_ID)?.let { return it }

        var attempts = 0
        while (SoulVoiceRecordPolicy.shouldKeepSwitching(attempts)) {
            attempts++
            // **只有确实在打字态才点开关。**
            //
            // 真机事故（2026-10-06 19:57/19:59）：录音面板没收干净时，录音入口也看不见，
            // 于是这里又去点开关 —— 但那时本来就是语音态，一点反而切成了打字态，
            // 状态越弄越乱，后面整条链全废。
            if (!SoulVoiceRecordPolicy.shouldTapModeToggle(
                    textInputVisible = findVisibleById(TEXT_INPUT_ID) != null
                )
            ) {
                android.util.Log.w(
                    "AIA",
                    "找不到录音入口，但也不在打字态（面板可能没关干净）—— 不点开关，免得切乱"
                )
                return null
            }
            val toggle = findVisibleById(RECORDER_MODE_TOGGLE_ID)
            if (toggle == null) {
                android.util.Log.w("AIA", "voice mode toggle not found")
                return null
            }
            if (!tapNode(toggle)) return null
            android.util.Log.d("AIA", "switch input to voice mode attempt=$attempts")

            val deadline = System.currentTimeMillis() +
                SoulVoiceRecordPolicy.VOICE_MODE_SWITCH_TIMEOUT_MS
            while (System.currentTimeMillis() <= deadline) {
                delay(SoulVoiceRecordPolicy.WAIT_SLICE_MS)
                findVisibleById(RECORDER_ENTRY_ID)?.let { return it }
            }
        }
        return findVisibleById(RECORDER_ENTRY_ID)
    }

    /**
     * 找当前屏幕上可见的节点。
     * 录音面板可能挂在独立的 window 上，所以 active window 和所有 window 都找一遍。
     */
    private fun findVisibleById(id: String): AccessibilityNodeInfo? {
        for (root in activeRoots()) {
            val hit = root.findAccessibilityNodeInfosByViewId(prefix + id)
                .firstOrNull { isVisibleOnScreen(it) }
            if (hit != null) return hit
        }
        return null
    }

    private fun activeRoots(): List<AccessibilityNodeInfo> = buildList {
        service.rootInActiveWindow?.let(::add)
        service.windows.forEach { window -> window.root?.let(::add) }
    }.distinctBy { System.identityHashCode(it) }

    companion object {
        // A named contact should be on the page we just resolved. If the row
        // moved, defer it to the next bounded scan instead of crawling several
        // pages up and down, which made the list visibly jump around.
        // Soul can spend more than ten seconds on a cold start before the
        // bottom tab bar exists; navigation must outlast the splash.
        private const val NAVIGATION_ATTEMPTS = 20

        private const val USER_PAUSE_MS = 5_000L
    // 条目数不超过这个值时不做内容形态校验（新会话通常 1-3 条，都是真消息）。
    private const val MIN_ITEMS_FOR_STRICT_CHECK = 3
    // 媒体气泡本体：文字容器不存在时（语音、表情、图片）用它判断左右。
    private val MEDIA_BUBBLE_IDS = listOf(
        "voice_bubble_container",
        "voice_bubble",
        "img_static",
        "image_content",
        "imv_bg",
        "click_view",
        "rl_animation",
        "llExpression",
    )

    // 媒体流程（面板/相册/预览）最多退几次。
    private const val MEDIA_FLOW_CLOSE_ATTEMPTS = 3
    // 这些 id 出现就说明还停在媒体流程里（它们都带遮罩）。
    private val MEDIA_FLOW_IDS = listOf(
        "media_menu_fragment_container",
        "chat_media_menu",
        "media_menu_viewpager",
        "iv_photo",
        "fl_select_mark",
        "rlBottomBar",
        "snap_chat_view",
        "preview_vp",
    )
    // 个人主页/关系卡片的结构 id；这些子树里的 item_root 不是聊天消息。
    private val PROFILE_CARD_IDS = listOf(
        "clCardRoot",
        "flAvatar",
        "tvOtherName",
        "tvPlanetArea",
        "gravityTagView",
        "tvStarSign",
        "llSameModule",
        "loveLayout",
        "cvRadar",
        "flVisitHomepage",
        "tvVisitHomepage",
        "appBarLayout",
        "extendSwitcher",
    )
    // 消息气泡里可能出现的媒体节点；一个都没有、也没有文字容器的 item_root 不是消息。
    private val MESSAGE_MEDIA_IDS = listOf(
        "voice_bubble",
        "img_static",
        "image",
        "image_content",
        "chat_image_url",
        "item_snap_pic_receive_root",
        "item_snap_pic_sender_root",
        "llExpression",
        "moment_card_root",
    )
    // 这些面板里的条目不是聊天消息，读取时要跳过。
    private val NON_MESSAGE_PANEL_IDS = listOf(
        "chat_media_menu",
        "media_menu_viewpager",
        "menu_tab_emoji",
        "menu_tab_voice_inner_outside",
        "menu_tab_more_inner",
        "menu_tab_more_inner_img",
    )
    // 点进去就跳个人资料页的入口，任何自动化都不许点。
    private val PROFILE_ENTRY_IDS = listOf(
        "flAvatar",
        "flVisitHomepage",
        "tvVisitHomepage",
        "chat_avatar",
        "avatar",
    )
        // Keep the user's page for a short moment only; 60s stalled the whole
        // working-set scan after any manual scroll.
        private const val USER_LIST_BROWSE_GRACE_MS = 20_000L
        // Soul can animate an interaction panel for several seconds. Waiting
        // too briefly used to drop an already generated reply.
        private const val TRANSIENT_OVERLAY_WAIT_ATTEMPTS = 12
        private const val TRANSIENT_OVERLAY_WAIT_DELAY_MS = 350L
        private val SECONDARY_BACK_IDS = listOf(
            "titlebar_back_ivbtn",
            "item_left_back"
        )
        // 聊天页左上角会盖住返回键的未读角标。
        private val SECONDARY_BACK_BLOCKER_IDS = listOf(
            "text_new_message",
            "red_text"
        )

        private val PHOTO_INDEX_PATTERN = Regex("图片第(\\d+)个")
        private val EXCHANGE_ENTRY_IDS = listOf(
            "image",
            "chat_exchange_change",
            "container"
        )
        private val INCOMING_IMAGE_TARGET_IDS = listOf(
            "image",
            "image_content",
            "chat_image_url"
        )
        private val IMAGE_TARGET_IDS = INCOMING_IMAGE_TARGET_IDS + "item_snap_pic_receive_root"
        // 转发动态卡片里那一张配图。只截它，作者和正文从节点直接读。
        private val MOMENT_CARD_IMAGE_IDS = listOf("image")
        // 语音录音面板（2026-10-06 真机实测确认的 viewId）。
        // 入口：输入栏右侧文字为「录音」的按钮。
        private const val RECORDER_ENTRY_ID = "audio_record_view_optimize"
        // 面板中间的大按钮：录音中和暂停后是两个不同节点，名字放在
        // SoulVoiceRecordPolicy.actionButtonIds 里（那边有真机依据，也好单测）。
        // 面板左下角的「取消」。
        private const val RECORDER_CANCEL_ID = "btn_delete"
        // 中间按钮下方的文字标签 —— 面板状态的唯一依据：
        // 录音中写「暂停录音」，暂停后写「发语音」。
        private const val RECORDER_MIDDLE_LABEL_ID = "tvRecordTips"
        // 输入栏左侧的"语音/文字"切换。只在找不到「录音」入口时才点它。
        private const val RECORDER_MODE_TOGGLE_ID = "menu_tab_voice_inner_outside"

        /** 打字态的输入框。它在 = 现在能打字；它不在 = 输入栏在语音态。 */
        private const val TEXT_INPUT_ID = "et_sendmessage"
        private val VOICE_TARGET_IDS = listOf(
            "voice_bubble",
            "iv_voice",
            "layout_voice_play",
            "voice_action_button",
            "audioContent",
            "audioContentLayout"
        )
        private val VOICE_EMOJI_ICON_IDS = listOf("iv_emoji")
        private val VOICE_EMOJI_PLAY_IDS = listOf("layout_voice_play")
        private val VOICE_EMOJI_START_IDS = listOf("iv_start")
        private val REGULAR_VOICE_IDS = listOf("voice_bubble")
        private val VOICE_ID_FRAGMENTS = listOf("voice", "audiocontent")
        private val VISUAL_TARGET_IDS = listOf(
            "image",
            "image_content",
            "chat_image_url",
            "llExpression",
            "img_static",
            "la_light_interaction",
            "item_snap_pic_receive_root",
            "voice_bubble",
            "iv_voice",
            "layout_voice_play",
            "voice_action_button",
            "audioContent",
            "audioContentLayout"
        )
    }
}
