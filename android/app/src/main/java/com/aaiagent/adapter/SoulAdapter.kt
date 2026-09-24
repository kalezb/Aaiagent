package com.aaiagent.adapter

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.adapter.PlatformAdapter.ConversationInfo
import com.aaiagent.adapter.PlatformAdapter.ListSnapshot
import com.aaiagent.adapter.PlatformAdapter.ScrollDirection
import com.aaiagent.adapter.PlatformAdapter.SendResult
import com.aaiagent.engine.ConversationIdentity
import com.aaiagent.engine.GestureMonitor
import com.aaiagent.engine.VoiceHandler
import kotlinx.coroutines.delay

class SoulAdapter(private val service: AccessibilityService) : PlatformAdapter {
    override val packageName = "cn.soulapp.android"

    private val prefix = "cn.soulapp.android:id/"
    private var emptyScanStreak = 0

    override fun isInChat(root: AccessibilityNodeInfo): Boolean {
        return root.packageName?.toString() == packageName &&
            root.findAccessibilityNodeInfosByViewId(prefix + "et_sendmessage").isNotEmpty()
    }

    override fun readChatTitle(root: AccessibilityNodeInfo): String? {
        val titles = root.findAccessibilityNodeInfosByViewId(prefix + "tv_title")
        for (node in titles) {
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && node.isVisibleToUser) return text
        }

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val rect = Rect()
            node.getBoundsInScreen(rect)
            val text = node.text?.toString()?.trim()
            if (!text.isNullOrEmpty() && text.length in 2..24 &&
                rect.top in 40..240 && rect.width() > 160 && node.isVisibleToUser
            ) {
                return text
            }
            for (index in 0 until node.childCount) {
                node.getChild(index)?.let(queue::add)
            }
        }
        return null
    }

    override fun isInMessageList(root: AccessibilityNodeInfo): Boolean {
        if (root.packageName?.toString() != packageName) return false
        if (root.findAccessibilityNodeInfosByViewId(prefix + "conversation_list").isNotEmpty()) return true
        val chatTab = root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
        val tabSelected = chatTab.any { it.isSelected || it.isFocused }
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
        return tabSelected && items.size >= 2
    }

    override fun listSnapshot(root: AccessibilityNodeInfo): ListSnapshot {
        val items = root.findAccessibilityNodeInfosByViewId(prefix + "item_content_root")
            .filter { it.isVisibleToUser }
        if (items.isEmpty()) return ListSnapshot()
        return ListSnapshot(
            itemCount = items.size,
            firstConversation = readChildText(items.first(), "name") ?: "",
            lastConversation = readChildText(items.last(), "name") ?: ""
        )
    }

    override fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage> {
        val messages = mutableListOf<ChatMessage>()
        val screenWidth = service.resources.displayMetrics.widthPixels
        val messageItems = root.findAccessibilityNodeInfosByViewId(prefix + "item_root")

        for (item in messageItems) {
            if (!item.isVisibleToUser) continue
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

            val sender = readMessageSender(item, screenWidth)

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
            val hasImage = item.findAccessibilityNodeInfosByViewId(prefix + "image").isNotEmpty() ||
                item.findAccessibilityNodeInfosByViewId(prefix + "image_content").isNotEmpty() ||
                item.findAccessibilityNodeInfosByViewId(prefix + "chat_image_url").isNotEmpty()
            val hasSticker = hasAnyVisibleViewId(item, STICKER_TARGET_IDS) ||
                hasDescendantViewIdFragment(item, STICKER_ID_FRAGMENTS) ||
                hasDescendantContentDescription(item, STICKER_CONTENT_DESCRIPTIONS)
            val hasInteraction = hasAnyVisibleViewId(item, INTERACTION_TARGET_IDS)
            val hasExchange = isExchangeItem(item)
            val type = SoulMediaType.resolve(
                hasVoice = hasVoice,
                hasImage = hasImage,
                hasSticker = hasSticker,
                hasInteraction = hasInteraction,
                hasSnapPhoto = hasSnapPhoto,
                hasText = text.isNotEmpty(),
                hasExchange = hasExchange,
                hasMomentCard = momentCardContent != null
            )

            val content = when {
                type == SoulMomentCard.TYPE -> momentCardContent ?: SoulMomentCard.FALLBACK
                type == "voice" -> SoulVoiceContent.resolve(voiceTranscription, text)
                text.isNotEmpty() -> text
                type == "exchange" -> "[以图换图]"
                type == "image" -> if (hasSnapPhoto) "[闪照]" else "[图片]"
                type == "interaction" -> "[拍一拍]"
                type == "sticker" -> "[表情]"
                else -> ""
            }
            if (content.isNotEmpty()) messages.add(ChatMessage(sender, content, type))
        }

        if (messages.isEmpty()) fallbackReadTextViews(root, messages, screenWidth)
        return messages
    }

    override suspend fun transcribeIncomingVoices(
        root: AccessibilityNodeInfo
    ): PlatformAdapter.VoiceTranscriptionResult {
        val screenWidth = service.resources.displayMetrics.widthPixels
        return VoiceHandler.transcribeIncomingVoices(
            service = service,
            root = root,
            isIncomingItem = { item -> readMessageSender(item, screenWidth) == "other" }
        )
    }

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
        targetType: String?
    ): PlatformAdapter.VisualCapturePreparation? {
        val item = findLatestIncomingVisualItem(root, targetType = targetType)
            ?: return PlatformAdapter.VisualCapturePreparation(root)
        if (isExchangeItem(item)) {
            return completeExchangeAndOpenIncoming(item)
        }
        val snapPhoto = item.findAccessibilityNodeInfosByViewId(prefix + "item_snap_pic_receive_root")
            .firstOrNull { it.isVisibleToUser }
            ?: return PlatformAdapter.VisualCapturePreparation(root)

        if (!tapNode(snapPhoto)) {
            return PlatformAdapter.VisualCapturePreparation(root, privacyProtected = true)
        }
        delay(1_200)
        val previewRoot = service.rootInActiveWindow
        if (previewRoot == null || !isPrivacyPreview(previewRoot)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            return PlatformAdapter.VisualCapturePreparation(root, privacyProtected = true)
        }
        return PlatformAdapter.VisualCapturePreparation(
            root = previewRoot,
            privacyProtected = true
        )
    }

    override suspend fun finishVisualCapture(root: AccessibilityNodeInfo) {
        val activeRoot = service.rootInActiveWindow ?: return
        if (isPrivacyPreview(activeRoot)) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            delay(600)
        }
    }

    private suspend fun completeExchangeAndOpenIncoming(
        exchangeItem: AccessibilityNodeInfo
    ): PlatformAdapter.VisualCapturePreparation? {
        if (!automationMayContinue()) return null
        val entry = findExchangeEntryNode(exchangeItem) ?: return null
        if (!tapNode(entry)) return null

        val albumRoot = waitForRoot(6, 800) { isAlbumPicker(it) } ?: run {
            android.util.Log.w("AIA", "Soul exchange album did not open")
            recoverToChat()
            return null
        }
        val firstPhoto = findFirstAlbumPhoto(albumRoot) ?: run {
            android.util.Log.w("AIA", "Soul exchange album has no selectable photo")
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
            ?: return null
        val imageTarget = findIncomingImageTarget(incomingImage) ?: return null
        if (!tapNode(imageTarget)) return PlatformAdapter.VisualCapturePreparation(protectedChat)
        val imagePreview = waitForRoot(5, 700) { isImagePreview(it) }
            ?: return PlatformAdapter.VisualCapturePreparation(protectedChat)
        val privacyProtected = incomingImage.findAccessibilityNodeInfosByViewId(prefix + "tv_privacy_protect_tag")
            .isNotEmpty()
        return PlatformAdapter.VisualCapturePreparation(
            root = imagePreview,
            privacyProtected = privacyProtected
        )
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
            if (root != null && isInChat(root)) return
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
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
        return isExchangeItem(item) || hasAnyVisibleId(item, targetIdsFor(targetType))
    }

    private fun targetIdsFor(targetType: String?): List<String> {
        return when (targetType) {
            "image" -> IMAGE_TARGET_IDS
            "sticker" -> STICKER_TARGET_IDS
            "interaction" -> INTERACTION_TARGET_IDS
            "voice" -> VOICE_TARGET_IDS
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
        if (node.className?.toString()?.contains("TextView") == true) {
            val text = node.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty() && text.length > 1) {
                val rect = Rect()
                node.getBoundsInScreen(rect)
                if (rect.top > 240 && rect.bottom < 2140) {
                    messages.add(ChatMessage(if (rect.left > screenWidth / 2) "self" else "other", text))
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
    ): SendResult {
        var currentRoot = service.rootInActiveWindow ?: return SendResult.TIMEOUT
        if (!isInChat(currentRoot)) return SendResult.NOT_VERIFIED
        if (!titleMatches(currentRoot, expectedContactName)) {
            android.util.Log.w("AIA", "Soul send blocked: conversation title mismatch, expected=$expectedContactName")
            return SendResult.NOT_VERIFIED
        }

        val beforeSelfCount = readMessages(currentRoot).count { it.sender == "self" }
        val input = findEditableInput(currentRoot) ?: return SendResult.TIMEOUT
        if (!setTextAndVerify(text)) return SendResult.NOT_VERIFIED

        currentRoot = service.rootInActiveWindow ?: return SendResult.NOT_VERIFIED
        if (!titleMatches(currentRoot, expectedContactName)) return SendResult.NOT_VERIFIED

        delay(700)
        val sendButton = findSendButtonWithRetry(input)
        val clicked = if (sendButton != null) {
            tapNode(sendButton)
        } else {
            tapSendFallback(input)
        }
        if (!clicked) return SendResult.TIMEOUT

        val verified = verifySent(text, beforeSelfCount)
        if (verified == SendResult.BANNED) return SendResult.BANNED
        return verified
    }

    suspend fun fillInputOnly(text: String, expectedContactName: String? = null): Boolean {
        val root = service.rootInActiveWindow ?: return false
        if (!isInChat(root) || !titleMatches(root, expectedContactName)) return false
        return setTextAndVerify(text)
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

    private suspend fun setTextAndVerify(text: String): Boolean {
        val expected = text.trim()
        if (expected.isEmpty()) return clearInput()

        repeat(3) { attempt ->
            if (setTextDirect(expected)) {
                android.util.Log.d("AIA", "Soul direct text succeeded attempt=${attempt + 1}")
                return true
            }

            if (pasteIntoInput(expected)) {
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

    private suspend fun setTextDirect(expected: String): Boolean {
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
        return inputContains(expected)
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

    private suspend fun pasteIntoInput(expected: String): Boolean {
        val clipboard = service.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return false
        val previous = runCatching {
            if (clipboard.hasPrimaryClip()) clipboard.primaryClip else null
        }.getOrNull()

        return try {
            clipboard.setPrimaryClip(ClipData.newPlainText("AI托管回复", expected))
            val input = freshInputNode() ?: return false
            GestureMonitor.onAutomationActionStarted()
            try {
                input.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                if (!input.isFocused) input.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                input.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            } finally {
                GestureMonitor.onAutomationActionFinished()
            }
            delay(900)
            inputContains(expected)
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

    private suspend fun findSendButtonWithRetry(input: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        repeat(5) { attempt ->
            if (attempt > 0) delay(500)
            val root = service.rootInActiveWindow ?: return@repeat
            val byId = root.findAccessibilityNodeInfosByViewId(prefix + "btn_send")
                .asSequence()
                .mapNotNull(::actionableNode)
                .firstOrNull { it.isVisibleToUser }
            if (byId != null) return byId

            val inputBounds = Rect()
            input.getBoundsInScreen(inputBounds)
            val candidates = mutableListOf<AccessibilityNodeInfo>()
            collectClickableNodes(root, candidates)
            candidates.firstOrNull {
                val bounds = Rect()
                it.getBoundsInScreen(bounds)
                bounds.left >= inputBounds.right - 30 &&
                    bounds.bottom >= inputBounds.top &&
                    bounds.top <= inputBounds.bottom + 80
            }?.let { return it }
        }
        return null
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

    private suspend fun tapSendFallback(input: AccessibilityNodeInfo): Boolean {
        val bounds = Rect()
        input.getBoundsInScreen(bounds)
        val screenWidth = service.resources.displayMetrics.widthPixels
        val screenHeight = service.resources.displayMetrics.heightPixels
        val x = (bounds.right + 55).coerceIn(40, screenWidth - 40).toFloat()
        val y = bounds.centerY().coerceIn(40, screenHeight - 40).toFloat()
        android.util.Log.w("AIA", "Soul send fallback tap x=$x y=$y")
        return performTap(x, y)
    }

    private suspend fun verifySent(
        text: String,
        beforeSelfCount: Int
    ): SendResult {
        repeat(3) { attempt ->
            delay(if (attempt == 0) 800 else 600)
            val root = service.rootInActiveWindow ?: return@repeat
            if (detectBanned(root)) return SendResult.BANNED

            val visibleMessages = readMessages(root)
            val selfMessages = visibleMessages.filter { it.sender == "self" }
            val expected = compact(text)
            val matched = visibleMessages.takeLast(8).any { compact(it.content) == expected }
            val inputCleared = isInChat(root) && currentInputText().isNullOrBlank()
            android.util.Log.d(
                "AIA",
                "send verify attempt=${attempt + 1} matched=$matched inputCleared=$inputCleared self=${selfMessages.size}/$beforeSelfCount last=${visibleMessages.lastOrNull()?.content}"
            )
            if (matched || inputCleared) return SendResult.SUCCESS
        }
        return SendResult.NOT_VERIFIED
    }

    private fun titleMatches(root: AccessibilityNodeInfo, expectedContactName: String?): Boolean {
        if (expectedContactName.isNullOrBlank()) return true
        return ConversationIdentity.matches(expectedContactName, readChatTitle(root))
    }

    private fun compact(value: String): String = value.replace(Regex("\\s+"), "").trim()

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

    override suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean
    ): ConversationInfo? {
        tryFindUnread(root, shouldClick)?.let {
            emptyScanStreak = 0
            return it
        }


        emptyScanStreak++
        val topRoot = scrollListToTop(root)
        tryFindUnread(topRoot, shouldClick)?.let {
            emptyScanStreak = 0
            return it
        }

        if (emptyScanStreak < FULL_PATROL_AFTER_EMPTY_SCANS) return null

        emptyScanStreak = 0
        var currentRoot = topRoot
        repeat(MAX_PATROL_SCROLLS) {
            if (!scrollConversationList(currentRoot, ScrollDirection.FORWARD)) return@repeat
            currentRoot = waitForStableListAfterScroll() ?: service.rootInActiveWindow ?: return@repeat
            tryFindUnread(currentRoot, shouldClick)?.let { return it }
        }
        scrollListToTop(currentRoot)
        return null
    }

    private fun tryFindUnread(root: AccessibilityNodeInfo, shouldClick: Boolean): ConversationInfo? {
        val badges = root.findAccessibilityNodeInfosByViewId(prefix + "unread_msg_number")
        for (badge in badges) {
            if (!badgeHasUnread(badge)) continue
            val item = findAncestorByViewId(badge, "item_content_root")
                ?: badge.parent?.parent?.parent
                ?: continue
            val name = readChildText(item, "name")
            val preview = readChildText(item, "message") ?: ""
            val contactName = name ?: preview.ifEmpty { "unknown" }
            if (contactName != TEST_CONTACT_ONLY) continue

            if (shouldClick) {
                val target = item.takeIf { it.isClickable && it.isVisibleToUser } ?: item
                if (!tapNode(target)) {
                    return ConversationInfo(contactName, contactName, preview)
                }
            }
            return ConversationInfo(
                contactId = contactName,
                contactName = contactName,
                preview = preview
            )
        }
        return null
    }

    private fun badgeHasUnread(badge: AccessibilityNodeInfo): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(badge)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (UnreadBadgeState.isUnread(
                    text = node.text?.toString(),
                    description = node.contentDescription?.toString()
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


    override fun scrollConversationList(root: AccessibilityNodeInfo, direction: ScrollDirection): Boolean {
        val action = if (direction == ScrollDirection.FORWARD) {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        }
        val recycler = root.findAccessibilityNodeInfosByViewId(prefix + "recycler_view")
            .firstOrNull { it.isScrollable && it.isVisibleToUser }
        if (recycler != null) {
            GestureMonitor.onAutomationActionStarted()
            val result = recycler.performAction(action)
            GestureMonitor.onAutomationActionFinished()
            return result
        }

        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable && node.isVisibleToUser) {
                GestureMonitor.onAutomationActionStarted()
                val result = node.performAction(action)
                GestureMonitor.onAutomationActionFinished()
                return result
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return false
    }

    private suspend fun waitForStableListAfterScroll(): AccessibilityNodeInfo? {
        delay(1_000)
        var previous = ListSnapshot(-1, "", "")
        var stableReads = 0
        repeat(3) { attempt ->
            val root = service.rootInActiveWindow ?: return null
            val current = listSnapshot(root)
            if (current == previous) stableReads++ else stableReads = 0
            if (stableReads >= 2) return root
            previous = current
            if (attempt < 2) delay(500)
        }
        return service.rootInActiveWindow
    }

    private suspend fun scrollListToTop(root: AccessibilityNodeInfo): AccessibilityNodeInfo {
        var current = root
        repeat(MAX_TOP_REWIND_SCROLLS) {
            if (!scrollConversationList(current, ScrollDirection.BACKWARD)) return current
            delay(450)
            current = service.rootInActiveWindow ?: return current
        }
        return current
    }

    override suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo) {
        if (isInMessageList(root)) return

        var current = root
        repeat(3) { attempt ->
            val fresh = service.rootInActiveWindow ?: current
            if (isInMessageList(fresh)) return

            val tab = findMessageTab(fresh)
            if (tab != null && tapNode(tab)) {
                delay(if (attempt == 0) 700L else 1_000L)
                val messageList = service.rootInActiveWindow
                if (messageList != null && isInMessageList(messageList)) return
                current = messageList ?: fresh
            } else {
                service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                delay(500)
                current = service.rootInActiveWindow ?: current
            }
        }

        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        delay(500)
        val fallbackRoot = service.rootInActiveWindow ?: return
        val fallbackTab = findMessageTab(fallbackRoot)
        if (fallbackTab != null && tapNode(fallbackTab)) {
            delay(900)
        }
    }

    private fun findMessageTab(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        root.findAccessibilityNodeInfosByViewId(prefix + "main_tab_msg")
            .asSequence()
            .mapNotNull(::clickableNode)
            .firstOrNull { it.isVisibleToUser }
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
                clickableNode(node)?.let { return it }
            }
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::add)
        }
        return null
    }

    private fun clickableNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(4) {
            val candidate = current ?: return null
            if (candidate.isClickable && candidate.isVisibleToUser) return candidate
            current = candidate.parent
        }
        return node.takeIf { it.isVisibleToUser }
    }

    override suspend fun bringToForeground(service: AccessibilityService) {
        val intent = service.packageManager.getLaunchIntentForPackage(packageName) ?: return
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        service.startActivity(intent)
        delay(1_500)
    }

    private fun tapNode(node: AccessibilityNodeInfo): Boolean {
        GestureMonitor.onAutomationActionStarted()
        val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (clicked) {
            GestureMonitor.onAutomationActionFinished()
            return true
        }
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val result = if (bounds.width() > 0 && bounds.height() > 0) {
            val screenWidth = service.resources.displayMetrics.widthPixels
            val screenHeight = service.resources.displayMetrics.heightPixels
            performTap(
                bounds.centerX().coerceIn(20, screenWidth - 20).toFloat(),
                bounds.centerY().coerceIn(20, screenHeight - 20).toFloat()
            )
        } else {
            false
        }
        GestureMonitor.onAutomationActionFinished()
        return result
    }

    private fun performTap(x: Float, y: Float): Boolean {
        GestureMonitor.onAutomationActionStarted()
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 0L, 1L))
            .build()
        val result = service.dispatchGesture(gesture, null, null)
        GestureMonitor.onAutomationActionFinished()
        return result
    }

    private fun collectClickableNodes(node: AccessibilityNodeInfo, results: MutableList<AccessibilityNodeInfo>) {
        if (node.isClickable && node.isVisibleToUser) results.add(node)
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

    private fun readMessageSender(item: AccessibilityNodeInfo, screenWidth: Int): String {
        val hasSelfAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "meAvatar").isNotEmpty()
        val hasOtherAvatar = item.findAccessibilityNodeInfosByViewId(prefix + "otherAvatar").isNotEmpty()
        val hasReadReceipt = item.findAccessibilityNodeInfosByViewId(prefix + "message_read").isNotEmpty()
        val avatarCenterX = centerX(item.findAccessibilityNodeInfosByViewId(prefix + "chat_avatar").firstOrNull())
        val contentCenterX = centerX(item.findAccessibilityNodeInfosByViewId(prefix + "content_text_container").firstOrNull())
        return SoulMessageDirection.resolve(
            isSelfAvatar = hasSelfAvatar,
            isOtherAvatar = hasOtherAvatar,
            hasReadReceipt = hasReadReceipt,
            avatarCenterX = avatarCenterX,
            contentCenterX = contentCenterX,
            screenWidth = screenWidth
        )
    }

    private fun centerX(node: AccessibilityNodeInfo?): Int? {
        val target = node ?: return null
        val bounds = Rect()
        target.getBoundsInScreen(bounds)
        return if (bounds.width() > 0) bounds.centerX() else null
    }

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

    private fun readChildText(parent: AccessibilityNodeInfo, viewId: String): String? {
        return parent.findAccessibilityNodeInfosByViewId(prefix + viewId)
            .firstOrNull { it.text?.toString()?.isNotBlank() == true }
            ?.text
            ?.toString()
            ?.trim()
    }

    companion object {
        private const val TEST_CONTACT_ONLY = "期待下一步的我们"
        private const val FULL_PATROL_AFTER_EMPTY_SCANS = 3
        private const val MAX_PATROL_SCROLLS = 3
        private const val MAX_TOP_REWIND_SCROLLS = 3
        private const val USER_PAUSE_MS = 5_000L
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
        private val STICKER_TARGET_IDS = listOf(
            "gif_intimacy",
            "iv_emoji",
            "fl_reflect_emoji",
            "iv_sticker",
            "sticker_view",
            "iv_gif",
            "gif_view"
        )
        private val STICKER_ID_FRAGMENTS = listOf("emoji", "sticker", "gif_intimacy")
        private val STICKER_CONTENT_DESCRIPTIONS = listOf("表情", "表情包", "贴纸")
        private val INTERACTION_TARGET_IDS = listOf("la_light_interaction", "img_back_poke")
        private val VOICE_TARGET_IDS = listOf(
            "voice_bubble",
            "iv_voice",
            "layout_voice_play",
            "voice_action_button",
            "audioContent",
            "audioContentLayout"
        )
        private val VOICE_ID_FRAGMENTS = listOf("voice", "audiocontent")
        private val VISUAL_TARGET_IDS = listOf(
            "image",
            "image_content",
            "chat_image_url",
            "gif_intimacy",
            "iv_emoji",
            "fl_reflect_emoji",
            "iv_sticker",
            "sticker_view",
            "iv_gif",
            "gif_view",
            "la_light_interaction",
            "img_back_poke",
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
