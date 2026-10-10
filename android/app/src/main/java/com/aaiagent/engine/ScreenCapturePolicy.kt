package com.aaiagent.engine

object ScreenCapturePolicy {
    fun isMostlyBlack(
        luminanceSamples: IntArray,
        darkThreshold: Int = 28,
        minimumVisibleRatio: Double = 0.02
    ): Boolean {
        if (luminanceSamples.isEmpty()) return true
        val visibleSamples = luminanceSamples.count { it > darkThreshold }
        return visibleSamples.toDouble() / luminanceSamples.size < minimumVisibleRatio
    }
}
