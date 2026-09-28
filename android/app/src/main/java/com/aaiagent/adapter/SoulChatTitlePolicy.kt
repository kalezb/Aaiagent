package com.aaiagent.adapter

internal data class SoulChatTitleCandidate(
    val text: String,
    val top: Int,
    val insideTopBar: Boolean,
    val insideCardDescription: Boolean
)

internal object SoulChatTitlePolicy {
    fun choose(candidates: List<SoulChatTitleCandidate>, screenHeight: Int): String? {
        val topRegionLimit = (screenHeight.coerceAtLeast(1) * TOP_REGION_HEIGHT_RATIO).toInt()
        return candidates.asSequence()
            .filter { it.text.isNotBlank() && !it.insideCardDescription }
            .filter { it.insideTopBar || it.top in 0..topRegionLimit }
            .sortedWith(
                compareByDescending<SoulChatTitleCandidate> { it.insideTopBar }
                    .thenBy { it.top }
            )
            .map { it.text.trim() }
            .firstOrNull()
    }

    private const val TOP_REGION_HEIGHT_RATIO = 0.18f
}
