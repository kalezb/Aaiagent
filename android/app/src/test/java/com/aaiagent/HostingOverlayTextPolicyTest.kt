package com.aaiagent

import com.aaiagent.engine.HostingOverlayTextPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostingOverlayTextPolicyTest {

    @Test
    fun `悬浮窗和前台服务的界面文字不算消息`() {
        // 真机事故（2026-10-07 爱吃鱼🐟）：这两条被当成对方发的消息读进去、还同步给了后端。
        assertTrue(HostingOverlayTextPolicy.isOverlayText("AI 托管"))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("已开启 AI 托管"))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("已关闭 AI 托管"))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("AI托管已开启"))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("AI托管运行中"))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("悬浮控制已就绪"))
        // 空格和大小写不该影响判定
        assertTrue(HostingOverlayTextPolicy.isOverlayText(" ai 托管 "))
        assertTrue(HostingOverlayTextPolicy.isOverlayText("AI  托管"))
    }

    @Test
    fun `对方真的提到 AI 托管时不能被误删`() {
        // 只按整条完全相等来比，不做包含匹配。
        assertFalse(HostingOverlayTextPolicy.isOverlayText("你是不是开了 AI 托管"))
        assertFalse(HostingOverlayTextPolicy.isOverlayText("AI 托管是什么"))
        assertFalse(HostingOverlayTextPolicy.isOverlayText("托管"))
        assertFalse(HostingOverlayTextPolicy.isOverlayText(""))
        assertFalse(HostingOverlayTextPolicy.isOverlayText(null))
        assertFalse(HostingOverlayTextPolicy.isOverlayText("我感觉你在用AI聊天"))
    }
}