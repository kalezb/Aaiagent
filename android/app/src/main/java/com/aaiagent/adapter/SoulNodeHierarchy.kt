package com.aaiagent.adapter

/** Finds an accessibility node by walking upward, including the starting node. */
object SoulNodeHierarchy {
    fun <T> findIncludingSelf(
        start: T,
        parentOf: (T) -> T?,
        viewIdOf: (T) -> String?,
        targetViewId: String
    ): T? {
        var current: T? = start
        while (current != null) {
            if (viewIdOf(current) == targetViewId) return current
            current = parentOf(current)
        }
        return null
    }
}
