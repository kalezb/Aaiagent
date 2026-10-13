package com.aaiagent

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class StructureGuardTest {
    @Test
    fun `core Android files stay within their current size ceilings`() {
        val limits = mapOf(
            "src/main/java/com/aaiagent/engine/MessageEngine.kt" to 4700,
            "src/main/java/com/aaiagent/adapter/SoulAdapter.kt" to 3800,
            "src/main/java/com/aaiagent/ui/screens/DashboardScreen.kt" to 500,
        )

        for ((relative, limit) in limits) {
            val lineCount = readSource(relative).lineSequence().count()
            assertTrue(
                "$relative should stay at or below $limit lines, actual=$lineCount",
                lineCount <= limit,
            )
        }
    }

    @Test
    fun `core automation code does not depend on dashboard UI`() {
        val engine = readSource("src/main/java/com/aaiagent/engine/MessageEngine.kt")
        val soulAdapter = readSource("src/main/java/com/aaiagent/adapter/SoulAdapter.kt")

        assertFalse("托管引擎不能反向依赖手机看板界面", engine.contains("import com.aaiagent.ui."))
        assertFalse("平台识别不能反向依赖手机看板界面", soulAdapter.contains("import com.aaiagent.ui."))
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
