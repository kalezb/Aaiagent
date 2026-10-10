package com.aaiagent

import com.aaiagent.engine.SyncTimePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncTimePolicyTest {
    @Test
    fun fillsMissingTimesAroundTheKnownAnchor() {
        val now = 1_800_000_000_000L
        // 第 3 条（index 2）有真实时间，其余没有
        val times = SyncTimePolicy.deriveSeconds(listOf(null, null, now, null, null), now)
        assertEquals(now / 1000 - 2, times[0])
        assertEquals(now / 1000 - 1, times[1])
        assertEquals(now / 1000, times[2])
        assertEquals(now / 1000 + 1, times[3])
        assertEquals(now / 1000 + 2, times[4])
    }

    @Test
    fun withoutAnyKnownTimeSpreadsBackwardsFromNow() {
        val now = 1_800_000_000_000L
        val times = SyncTimePolicy.deriveSeconds(listOf(null, null, null), now)
        assertEquals(now / 1000 - 2, times[0])
        assertEquals(now / 1000 - 1, times[1])
        assertEquals(now / 1000, times[2])
        // 顺序必须严格递增，这样云端排序才和屏幕一致
        assertTrue(times[0] < times[1] && times[1] < times[2])
    }
}
