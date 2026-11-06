package com.aaiagent.engine

/**
 * 给同一段对话里的每条消息分配稳定位置。
 *
 * Soul 页面只给内容，不给能直接读到的新消息编号。旧逻辑只用“谁发的 + 内容”
 * 认消息，所以对方隔一会儿又说一句同样的话时会和上一条撞在一起。这里把
 * 联系人列表预览和当前聊天页顺序对起来，只给真正追加在后面的消息新位置。
 */
object ConversationMessageLedger {
    data class Result(
        val items: List<SyncSnapshotItem>,
        val newIndexes: List<Int>,
        val ambiguous: Boolean,
        val nextOrdinal: Long,
        val matchedCount: Int,
    )

    fun reconcile(
        previous: List<SyncSnapshotItem>,
        current: List<SyncSnapshotItem>,
        hasEstablishedBaseline: Boolean,
        nextOrdinal: Long,
    ): Result {
        if (current.isEmpty()) {
            return Result(
                items = emptyList(),
                newIndexes = emptyList(),
                ambiguous = false,
                nextOrdinal = nextOrdinal,
                matchedCount = 0,
            )
        }

        val currentKeys = current.map(::contentKey)
        if (!hasEstablishedBaseline || previous.isEmpty()) {
            var ordinal = nextOrdinal
            val items = current.mapIndexed { index, item ->
                ordinal += 1L
                item.copy(
                    contentKey = currentKeys[index],
                    stableKey = positionKey(currentKeys[index], occurrence(currentKeys, index)),
                    ledgerOrdinal = ordinal,
                )
            }
            return Result(
                items = items,
                newIndexes = emptyList(),
                ambiguous = false,
                nextOrdinal = ordinal,
                matchedCount = 0,
            )
        }

        val previousKeys = previous.map(::contentKey)
        val match = longestMatch(previousKeys, currentKeys)
        // 最新一页必须还能看见上次记录的最后一条。看不见通常表示页面停在旧位置、
        // 读到了缓存会话，或聊天页还没滚到最新；这时不能把旧窗口当成新历史保存。
        val reachesKnownLatest = match.length > 0 &&
            match.previousStart + match.length == previous.size
        if (!reachesKnownLatest) {
            return Result(
                items = current.mapIndexed { index, item ->
                    item.copy(
                        contentKey = currentKeys[index],
                        stableKey = "",
                        ledgerOrdinal = null,
                    )
                },
                newIndexes = emptyList(),
                ambiguous = true,
                nextOrdinal = nextOrdinal,
                matchedCount = match.length,
            )
        }

        var ordinal = nextOrdinal
        val matchedPositions = mutableMapOf<Int, Pair<String, Long?>>()
        repeat(match.length) { offset ->
            val previousItem = previous[match.previousStart + offset]
            val currentIndex = match.currentStart + offset
            matchedPositions[currentIndex] = previousItem.stableKey.orEmpty() to
                previousItem.ledgerOrdinal
        }

        val items = current.mapIndexed { index, item ->
            val matched = matchedPositions[index]
            if (matched != null) {
                val position = matched.first.ifBlank {
                    positionKey(currentKeys[index], occurrence(currentKeys, index))
                }
                item.copy(
                    contentKey = currentKeys[index],
                    stableKey = position,
                    ledgerOrdinal = matched.second,
                )
            } else if (index < match.currentStart) {
                item.copy(
                    contentKey = currentKeys[index],
                    stableKey = "",
                    ledgerOrdinal = null,
                )
            } else {
                ordinal += 1L
                item.copy(
                    contentKey = currentKeys[index],
                    stableKey = positionKey(currentKeys[index], occurrence(currentKeys, index)),
                    ledgerOrdinal = ordinal,
                )
            }
        }

        val appendStart = match.currentStart + match.length
        return Result(
            items = items,
            newIndexes = (appendStart until current.size).toList(),
            ambiguous = false,
            nextOrdinal = ordinal,
            matchedCount = match.length,
        )
    }

    /**
     * 当前页只显示到一条新消息、旧记录的尾巴已经滚出屏幕时，
     * 在列表预览已确认最新内容的前提下，把可见新消息接在旧账本后面。
     */
    fun appendVisibleLatest(
        previous: List<SyncSnapshotItem>,
        current: List<SyncSnapshotItem>,
        nextOrdinal: Long,
    ): Result {
        if (current.isEmpty()) {
            return Result(
                items = previous,
                newIndexes = emptyList(),
                ambiguous = false,
                nextOrdinal = nextOrdinal,
                matchedCount = 0,
            )
        }
        val previousKeys = previous.map(::contentKey)
        val currentKeys = current.map(::contentKey)
        val allKeys = previousKeys + currentKeys
        var ordinal = nextOrdinal
        val appended = current.mapIndexed { index, item ->
            ordinal += 1L
            val combinedIndex = previous.size + index
            item.copy(
                contentKey = currentKeys[index],
                stableKey = positionKey(allKeys[combinedIndex], occurrence(allKeys, combinedIndex)),
                ledgerOrdinal = ordinal,
            )
        }
        return Result(
            items = previous + appended,
            newIndexes = (previous.size until previous.size + appended.size).toList(),
            ambiguous = false,
            nextOrdinal = ordinal,
            matchedCount = 0,
        )
    }

    private data class Match(
        val previousStart: Int,
        val currentStart: Int,
        val length: Int,
    )

    /**
     * 优先把上次记录的结尾和这次页面的开头接上；如果页面前面多读了旧消息，
     * 也允许从中任意位置接上。没有任何连续重合时交给调用方停止，不猜。
     */
    private fun longestMatch(previous: List<String>, current: List<String>): Match {
        var best = Match(0, 0, 0)
        for (previousStart in previous.indices) {
            for (currentStart in current.indices) {
                var length = 0
                while (
                    previousStart + length < previous.size &&
                    currentStart + length < current.size &&
                    previous[previousStart + length] == current[currentStart + length]
                ) {
                    length += 1
                }
                if (length > best.length ||
                    (length == best.length &&
                        length > 0 &&
                        score(previousStart, currentStart, length, previous.size) >
                        score(best.previousStart, best.currentStart, best.length, previous.size))
                ) {
                    best = Match(previousStart, currentStart, length)
                }
            }
        }
        return best
    }

    private fun score(
        previousStart: Int,
        currentStart: Int,
        length: Int,
        previousSize: Int,
    ): Int {
        val reachesPreviousEnd = previousStart + length == previousSize
        return (if (reachesPreviousEnd) 1_000 else 0) - currentStart - previousStart
    }

    private fun contentKey(item: SyncSnapshotItem): String {
        return item.contentKey
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?: item.stableKey
                ?.trim()
                ?.takeIf(String::isNotEmpty)
            ?: "${item.role}\u001f${item.content.trim()}"
    }

    private fun occurrence(keys: List<String>, endInclusive: Int): Int {
        val base = keys[endInclusive]
        return keys.take(endInclusive + 1).count { it == base }
    }

    private fun positionKey(contentKey: String, occurrence: Int): String {
        return if (occurrence <= 1) contentKey else "$contentKey#occ:$occurrence"
    }
}
