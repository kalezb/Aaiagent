package com.aaiagent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SecurityManifestPolicyTest {
    @Test
    fun `manifest keeps backup off and restricts exported services`() {
        val manifest = readSource("src/main/AndroidManifest.xml")

        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertTrue(
            manifest.contains(
                "android:name=\".service.AssistantAccessibilityService\""
            )
        )
        assertTrue(
            manifest.contains(
                "android:permission=\"android.permission.BIND_ACCESSIBILITY_SERVICE\""
            )
        )
        assertTrue(
            manifest.contains(
                "android:permission=\"android.permission.BIND_NOTIFICATION_LISTENER_SERVICE\""
            )
        )
        assertTrue(manifest.contains("android:exported=\"false\""))
    }

    @Test
    fun `pcm channel only accepts the soul process`() {
        val provider = readSource(
            "src/main/java/com/aaiagent/xposed/InjectPcmProvider.kt"
        )
        val networkConfig = readSource("src/main/res/xml/network_security_config.xml")

        assertTrue(provider.contains("private fun callerAllowed(ctx: Context): Boolean"))
        assertTrue(provider.contains("const val SOUL_PACKAGE = \"cn.soulapp.android\""))
        assertTrue(provider.contains("if (!callerAllowed(ctx)) return null"))
        assertFalse(networkConfig.contains("cleartextTrafficPermitted=\"true\""))
        assertTrue(networkConfig.contains("cleartextTrafficPermitted=\"false\""))
    }

    private fun readSource(relative: String): String {
        val candidates = listOf(
            File(relative),
            File("app/$relative"),
            File("android/app/$relative"),
        )
        val file = candidates.firstOrNull(File::isFile)
            ?: error("找不到源文件 $relative")
        return file.readText()
    }
}
