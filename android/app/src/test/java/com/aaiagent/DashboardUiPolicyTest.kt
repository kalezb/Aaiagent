package com.aaiagent

import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.screens.DashboardUiPolicy
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.screens.PersonaPresentation
import org.junit.Assert.assertEquals
import org.junit.Test

class DashboardUiPolicyTest {
    @Test
    fun `uses selected platform and shows hosting state`() {
        assertEquals("soul", DashboardUiPolicy.activePlatform(emptySet()))
        assertEquals("qq", DashboardUiPolicy.activePlatform(setOf("qq")))
        assertEquals(
            "QQ 托管运行中",
            DashboardUiPolicy.connectionText(true, "qq", corePermissionsReady = true, tokenReady = true)
        )
    }

    @Test
    fun `describes readiness before hosting starts`() {
        assertEquals(
            "Soul 已就绪",
            DashboardUiPolicy.connectionText(false, "soul", corePermissionsReady = true, tokenReady = true)
        )
        assertEquals(
            "Soul 待验证",
            DashboardUiPolicy.connectionText(false, "soul", corePermissionsReady = true, tokenReady = false)
        )
        assertEquals(
            "设备权限待完善",
            DashboardUiPolicy.connectionText(false, "soul", corePermissionsReady = false, tokenReady = false)
        )
    }

    @Test
    fun `hosting modes use concise labels without secondary copy`() {
        assertEquals("全自动", DashboardUiPolicy.hostingModeLabel(HostingMode.FULL_AUTO))
        assertEquals("半自动", DashboardUiPolicy.hostingModeLabel(HostingMode.SEMI_AUTO))
        assertEquals("仅记录", DashboardUiPolicy.hostingModeLabel(HostingMode.MONITOR_ONLY))
    }

    @Test
    fun `counts granted device permissions`() {
        assertEquals(3, DashboardUiPolicy.healthyPermissionCount(true, true, false, true))
        assertEquals(0, DashboardUiPolicy.healthyPermissionCount(false, false, false, false))
    }

    @Test
    fun `persona card uses the first character as avatar`() {
        val persona = PersonaItem(id = "female_xingmu", name = "星暮", gender = "female")
        assertEquals("星", PersonaPresentation.avatarLabel(persona))
        assertEquals("星暮", PersonaPresentation.name(persona))
        assertEquals("自然亲切", PersonaPresentation.roleDetail(persona))
    }
}
