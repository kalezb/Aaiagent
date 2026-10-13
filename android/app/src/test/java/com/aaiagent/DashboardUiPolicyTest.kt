package com.aaiagent

import com.aaiagent.engine.HostingMode
import com.aaiagent.ui.screens.DashboardUiPolicy
import com.aaiagent.ui.screens.ConnectionTone
import com.aaiagent.ui.screens.ModelLineHealthState
import com.aaiagent.ui.screens.PersonaItem
import com.aaiagent.ui.screens.PersonaPresentation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DashboardUiPolicyTest {
    @Test
    fun `uses selected platform and shows hosting state`() {
        assertEquals("soul", DashboardUiPolicy.activePlatform(emptySet()))
        assertEquals("qq", DashboardUiPolicy.activePlatform(setOf("qq")))
        assertEquals(
            "QQ 托管运行中",
            DashboardUiPolicy.connectionText(
                true,
                "qq",
                corePermissionsReady = true,
                tokenReady = true,
                lineHealth = ModelLineHealthState.CONNECTED,
                lineName = "线路A"
            )
        )
    }

    @Test
    fun `describes readiness before hosting starts`() {
        assertEquals(
            "Soul 已就绪",
            DashboardUiPolicy.connectionText(
                false,
                "soul",
                corePermissionsReady = true,
                tokenReady = true,
                lineHealth = ModelLineHealthState.CONNECTED,
                lineName = "线路A"
            )
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
    fun `line health drives the top status light`() {
        assertEquals(
            "线路A 待检测",
            DashboardUiPolicy.connectionText(
                isHosting = false,
                platform = "soul",
                corePermissionsReady = true,
                tokenReady = true,
                lineHealth = ModelLineHealthState.UNKNOWN,
                lineName = "线路A"
            )
        )
        assertEquals(
            ConnectionTone.YELLOW,
            DashboardUiPolicy.connectionTone(true, true, ModelLineHealthState.UNKNOWN)
        )
        assertEquals(
            ConnectionTone.GREEN,
            DashboardUiPolicy.connectionTone(true, true, ModelLineHealthState.CONNECTED)
        )
        assertEquals(
            ConnectionTone.RED,
            DashboardUiPolicy.connectionTone(true, true, ModelLineHealthState.FAILED)
        )
    }

    @Test
    fun `token failure is red even before a line check`() {
        assertEquals(
            "Soul 待验证",
            DashboardUiPolicy.connectionText(false, "soul", corePermissionsReady = true, tokenReady = false)
        )
        assertEquals(
            ConnectionTone.RED,
            DashboardUiPolicy.connectionTone(true, false, ModelLineHealthState.UNKNOWN)
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

    @Test
    fun `device security card stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val card = readSource("src/main/java/com/aaiagent/ui/screens/DashboardDeviceSecurityCard.kt")

        assertFalse(
            "设备钥匙卡片不能继续留在看板大文件里",
            screen.contains("private fun DeviceSecurityCard("),
        )
        assertTrue(
            "设备钥匙卡片应该放在单独的小文件里",
            card.contains("internal fun DeviceSecurityCard("),
        )
    }

    @Test
    fun `shared persona facts card stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val card = readSource("src/main/java/com/aaiagent/ui/screens/DashboardSharedPersonaFactsCard.kt")

        assertFalse(
            "共享人设资料卡片不能继续留在看板大文件里",
            screen.contains("private fun SharedPersonaFactsCard("),
        )
        assertTrue(
            "共享人设资料卡片应该放在单独的小文件里",
            card.contains("internal fun SharedPersonaFactsCard("),
        )
        assertTrue(
            "共享人设资料的行组件应该跟着卡片一起搬走",
            card.contains("private fun SharedFactRow("),
        )
    }

    @Test
    fun `voice output row stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val row = readSource("src/main/java/com/aaiagent/ui/screens/DashboardVoiceOutputRow.kt")

        assertFalse(
            "配音方式不能继续留在看板大文件里",
            screen.contains("private fun VoiceOutputRow("),
        )
        assertTrue(
            "配音方式应该放在单独的小文件里",
            row.contains("internal fun VoiceOutputRow("),
        )
    }

    @Test
    fun `self nickname row stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val row = readSource("src/main/java/com/aaiagent/ui/screens/DashboardSelfNicknameRow.kt")

        assertFalse(
            "账号昵称设置不能继续留在看板大文件里",
            screen.contains("private fun SelfNicknameRow("),
        )
        assertTrue(
            "账号昵称设置应该放在单独的小文件里",
            row.contains("internal fun SelfNicknameRow("),
        )
    }

    @Test
    fun `permission row stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val row = readSource("src/main/java/com/aaiagent/ui/screens/DashboardPermissionRow.kt")

        assertFalse(
            "权限状态行不能继续留在看板大文件里",
            screen.contains("private fun PermissionRow("),
        )
        assertTrue(
            "权限状态行应该放在单独的小文件里",
            row.contains("internal fun PermissionRow("),
        )
    }

    @Test
    fun `toggle row and switch stay in their own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val row = readSource("src/main/java/com/aaiagent/ui/screens/DashboardToggleRow.kt")

        assertFalse(
            "开关设置行不能继续留在看板大文件里",
            screen.contains("private fun ToggleRow("),
        )
        assertFalse(
            "小开关不能继续留在看板大文件里",
            screen.contains("private fun SkySwitch("),
        )
        assertTrue(
            "开关设置行应该放在单独的小文件里",
            row.contains("internal fun ToggleRow("),
        )
        assertTrue(
            "小开关应该和开关设置行放在一起",
            row.contains("internal fun SkySwitch("),
        )
    }

    @Test
    fun `voice send test entry is removed`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val main = readSource("src/main/java/com/aaiagent/MainActivity.kt")
        val deletedFiles = listOf(
            File("src/main/java/com/aaiagent/ui/screens/DashboardVoiceSendTestRow.kt"),
            File("app/src/main/java/com/aaiagent/ui/screens/DashboardVoiceSendTestRow.kt"),
            File("android/app/src/main/java/com/aaiagent/ui/screens/DashboardVoiceSendTestRow.kt"),
        )

        assertFalse("看板里不能继续出现语音发送测试入口", screen.contains("VoiceSendTestRow"))
        assertFalse("看板不能再传语音测试状态", screen.contains("voiceTestStatus"))
        assertFalse("看板不能再传语音测试点击动作", screen.contains("onVoiceTest"))
        assertFalse("手机端不能继续保存语音测试状态", main.contains("voiceTestStatus"))
        assertFalse("手机端不能继续保留语音测试点击动作", main.contains("runVoiceTest"))
        assertTrue("语音发送测试单独文件应该已经删掉", deletedFiles.none(File::exists))
    }

    private fun readSource(relative: String): String {
        val candidates = listOf(
            File(relative),
            File("app/$relative"),
            File("android/app/$relative"),
        )
        val file = candidates.firstOrNull(File::isFile)
            ?: error("找不到源文件 $relative，试过: ${candidates.map(File::getAbsolutePath)}")
        return file.readText()
    }
}
