package com.aaiagent

import com.aaiagent.ui.components.FloatingWindowStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class FloatingWindowStatusTest {
    @Test
    fun `floating control uses explicit state labels`() {
        assertEquals("AI托管已关闭", FloatingWindowStatus.OFF.label)
        assertEquals("AI托管已开启", FloatingWindowStatus.ON.label)
        assertEquals("正在开启...", FloatingWindowStatus.BUSY_ON.label)
        assertEquals("正在关闭...", FloatingWindowStatus.BUSY_OFF.label)
    }
}
