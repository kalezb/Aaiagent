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
        val engine = readSource("src/main/java/com/aaiagent/engine/MessageEngine.kt")
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
        assertFalse("底层不能继续保留语音测试动作", engine.contains("runVoiceSendTest"))
        assertFalse("底层不能继续保留语音测试内容", engine.contains("VOICE_TEST"))
        assertFalse("底层不能继续保留语音测试结果日志", engine.contains("publishVoiceTest"))
        assertTrue("语音发送测试单独文件应该已经删掉", deletedFiles.none(File::exists))
    }

    @Test
    fun `unused dashboard choice and address helpers stay removed`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")

        assertFalse("没人用的选项按钮小块不能继续留在看板里", screen.contains("private fun ChoiceChips("))
        assertFalse("没人用的地址输入小块不能继续留在看板里", screen.contains("private fun AddressField("))
    }

    @Test
    fun `hosting mode selector stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val selector = readSource("src/main/java/com/aaiagent/ui/screens/DashboardHostingModeSelector.kt")

        assertFalse(
            "托管方式选择器不能继续留在看板大文件里",
            screen.contains("private fun HostingModeSelector("),
        )
        assertTrue(
            "托管方式选择器应该放在单独的小文件里",
            selector.contains("internal fun HostingModeSelector("),
        )
    }

    @Test
    fun `overview stats stay in their own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val stats = readSource("src/main/java/com/aaiagent/ui/screens/DashboardOverviewStats.kt")

        assertFalse(
            "今日状态统计不能继续留在看板大文件里",
            screen.contains("private fun OverviewStats("),
        )
        assertTrue(
            "今日状态统计应该放在单独的小文件里",
            stats.contains("internal fun OverviewStats("),
        )
        assertTrue(
            "统计小卡片应该跟着统计区域一起搬走",
            stats.contains("private fun StatCard("),
        )
    }

    @Test
    fun `dashboard header stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val header = readSource("src/main/java/com/aaiagent/ui/screens/DashboardHeader.kt")

        assertFalse(
            "看板顶部标题区不能继续留在看板大文件里",
            screen.contains("private fun DashboardHeader("),
        )
        assertTrue(
            "看板顶部标题区应该放在单独的小文件里",
            header.contains("internal fun DashboardHeader("),
        )
    }

    @Test
    fun `hosting hero stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val hero = readSource("src/main/java/com/aaiagent/ui/screens/DashboardHostingHero.kt")

        assertFalse(
            "AI 托管主开关不能继续留在看板大文件里",
            screen.contains("private fun HostingHero("),
        )
        assertTrue(
            "AI 托管主开关应该放在单独的小文件里",
            hero.contains("internal fun HostingHero("),
        )
    }

    @Test
    fun `incident feedback card stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val feedback = readSource("src/main/java/com/aaiagent/ui/screens/DashboardIncidentFeedbackCard.kt")

        assertFalse(
            "问题反馈卡片不能继续留在看板大文件里",
            screen.contains("private fun IncidentFeedbackCard("),
        )
        assertTrue(
            "问题反馈卡片应该放在单独的小文件里",
            feedback.contains("internal fun IncidentFeedbackCard("),
        )
    }

    @Test
    fun `quick management stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val management = readSource("src/main/java/com/aaiagent/ui/screens/DashboardQuickManagement.kt")

        assertFalse(
            "快捷管理不能继续留在看板大文件里",
            screen.contains("private fun QuickManagement("),
        )
        assertFalse(
            "快捷管理用的分隔线不能继续留在看板大文件里",
            screen.contains("private fun RowDivider("),
        )
        assertTrue(
            "快捷管理应该放在单独的小文件里",
            management.contains("internal fun QuickManagement("),
        )
        assertTrue(
            "快捷管理需要一起搬走的线路切换应该在同一个文件里",
            management.contains("private fun LineSwitchRow("),
        )
    }

    @Test
    fun `platform option stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val option = readSource("src/main/java/com/aaiagent/ui/screens/DashboardPlatformOption.kt")

        assertFalse(
            "平台选项按钮不能继续留在看板大文件里",
            screen.contains("private fun PlatformOption("),
        )
        assertTrue(
            "平台选项按钮应该放在单独的小文件里",
            option.contains("internal fun PlatformOption("),
        )
    }

    @Test
    fun `persona selector stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val selector = readSource("src/main/java/com/aaiagent/ui/screens/DashboardPersonaSelector.kt")

        assertFalse(
            "客服选择器不能继续留在看板大文件里",
            screen.contains("private fun PersonaSelector("),
        )
        assertTrue(
            "客服选择器应该放在单独的小文件里",
            selector.contains("internal fun PersonaSelector("),
        )
    }

    @Test
    fun `platform persona card stays in its own source file`() {
        val screen = readSource("src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt")
        val card = readSource("src/main/java/com/aaiagent/ui/screens/DashboardPlatformPersonaCard.kt")

        assertFalse(
            "平台与人设卡片不能继续留在看板大文件里",
            screen.contains("private fun PlatformPersonaCard("),
        )
        assertTrue(
            "平台与人设卡片应该放在单独的小文件里",
            card.contains("internal fun PlatformPersonaCard("),
        )
        assertTrue(
            "应用按钮应该跟着平台与人设卡片一起搬走",
            card.contains("private fun SkySmallAction("),
        )
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
