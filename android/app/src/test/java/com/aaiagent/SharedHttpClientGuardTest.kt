package com.aaiagent

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 防止"每个请求重新握手"这个毛病复发。
 *
 * 真机实测（2026-10-07）：ApiService 每个实例都 new 一个 OkHttpClient，而
 * MessageEngine 每次调用都新建 ApiService —— 连接池每次都是空的，于是每个请求
 * 都要重做 TCP + TLS 握手（connect/tls 0.9~3.4 秒），服务端本身只花 2.1~3.4 秒。
 */
class SharedHttpClientGuardTest {

    @Test
    fun `ApiService 必须共用一个 OkHttpClient`() {
        val source = readSource("src/main/java/com/aaiagent/network/ApiService.kt")
        assertTrue("ApiService.kt 里应该有一个进程级共享的客户端", source.contains("SHARED_HTTP_CLIENT"))
        assertFalse(
            "不能再出现每个实例各 new 一个客户端的写法，那样连接池永远是空的",
            source.contains("private val shortClient = OkHttpClient.Builder()"),
        )
    }

    @Test
    fun `手机端不能再保存共享人设资料`() {
        val activity = readSource("src/main/java/com/aaiagent/MainActivity.kt")
        val sharedFacts = readSource(
            "src/main/java/com/aaiagent/ui/screens/DashboardSharedPersonaFactsCard.kt",
        )
        assertFalse(
            "手机端不能再调用旧的本机覆盖保存动作",
            activity.contains("save_persona_facts"),
        )
        assertTrue(
            "共享资料卡片要明确告诉用户手机端只读",
            sharedFacts.contains("所有设备共用同一套资料，手机端只读"),
        )
        assertTrue(
            "共享资料卡片要指向客户看板修改",
            sharedFacts.contains("请到客户看板"),
        )
    }

    private fun readSource(relative: String): String {
        // Gradle 单测的工作目录是模块目录（android/app），这里再兜一层，避免换环境后误报。
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
