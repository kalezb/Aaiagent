package com.aaiagent.xposed

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Binder
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.SystemClock
import java.io.File

/**
 * "待注入的配音 PCM"的存放处 + 交付通道。
 *
 * 为什么需要它：注入代码虽然打包在 AiaAgent 里，但它跑在 **Soul 的进程**；
 * 配音却是 AiaAgent 自己的进程解码好的。两个进程要传数据，就得有这么一个通道。
 *
 * 安全：只认 Soul 进程来读（别的应用一律拒绝），否则任何 App 都能把声音塞进麦克风。
 *
 * 交付用文件描述符而不是字节数组 —— 一段 20 秒的配音有 600 多 KB，
 * 走 Binder 传大数组容易撞上限。
 */
object InjectPcmStore {

    const val AUTHORITY = "com.aaiagent.inject"

    private const val FILE_NAME = "inject.pcm"

    /** 交付后多久没被取走就作废，避免旧的配音被下一次手动录音误用。 */
    const val TTL_MS = 30_000L

    data class State(
        val ready: Boolean,
        val rate: Int,
        val channels: Int,
        val bytes: Long,
        val generation: Long,
        val consumed: Boolean,
        val publishedAtMillis: Long
    )

    @Volatile
    private var generation = 0L

    @Volatile
    private var consumed = true

    @Volatile
    private var rate = 16_000

    @Volatile
    private var channels = 1

    @Volatile
    private var publishedAtMillis = 0L

    /**
     * 注入模块最近一次来"取货"的时间（开机计时）。
     *
     * 模块每 400ms 轮询一次这个通道；没 root 的手机上根本没有模块，
     * 就永远不会有人来问。**这是判断"这台手机能不能用注入"的唯一可靠依据**
     * —— 判断结果决定走注入还是走外放（见 VoiceOutputMode）。
     */
    @Volatile
    private var lastModuleContactAt = 0L

    /** 模块多久没来问，就认定它不在了。比轮询间隔（400ms）宽得多，避免误判。 */
    private const val MODULE_ALIVE_WINDOW_MS = 5_000L

    /** 模块来取货时记一笔（由 InjectPcmProvider.query 调用，只有 Soul 进程能触发）。 */
    fun markModuleContact() {
        lastModuleContactAt = android.os.SystemClock.elapsedRealtime()
    }

    /**
     * 注入模块现在在运行吗。
     *
     * 只有**Soul 进程**能触发这个通道的查询（见 InjectPcmProvider.callerAllowed），
     * 而模块就跑在 Soul 进程里 —— 所以"最近有人来问过"等价于"模块活着"。
     */
    fun isModuleAlive(): Boolean {
        val last = lastModuleContactAt
        if (last <= 0L) return false
        return android.os.SystemClock.elapsedRealtime() - last < MODULE_ALIVE_WINDOW_MS
    }

    fun file(context: Context): File = File(context.filesDir, FILE_NAME)

    /**
     * 发布一段"下一次录音要注入"的配音。返回新的代次号。
     * 每次发布代次号 +1，注入模块靠它判断"这是新的一段"，避免重复注入。
     */
    @Synchronized
    fun publish(context: Context, pcm: ByteArray, sampleRate: Int, channelCount: Int): Long {
        if (pcm.isEmpty() || sampleRate <= 0 || channelCount <= 0) return generation
        val target = file(context)
        target.parentFile?.mkdirs()
        target.writeBytes(pcm)
        rate = sampleRate
        channels = channelCount
        consumed = false
        publishedAtMillis = System.currentTimeMillis()
        generation += 1L
        return generation
    }

    @Synchronized
    fun state(context: Context): State {
        val target = file(context)
        val expired = publishedAtMillis > 0L &&
            System.currentTimeMillis() - publishedAtMillis > TTL_MS
        val alive = target.exists() && target.length() > 0L && !consumed && !expired
        return State(
            ready = alive,
            rate = rate,
            channels = channels,
            bytes = if (target.exists()) target.length() else 0L,
            generation = generation,
            consumed = consumed || expired,
            publishedAtMillis = publishedAtMillis
        )
    }

    /**
     * 标记这一段已经被用掉。[expectedGeneration] 对不上就拒绝 ——
     * 防止模块消费掉一段刚发布的新配音（时序错位）。
     */
    @Synchronized
    fun consume(context: Context, expectedGeneration: Long): Boolean {
        if (expectedGeneration != generation || consumed) return false
        consumed = true
        return true
    }

    @Synchronized
    fun clear(context: Context) {
        consumed = true
        publishedAtMillis = 0L
        runCatching { file(context).delete() }
    }
}

/**
 * 交付通道本体。[InjectPcmStore] 管数据，这里只负责"给不给"和"给什么"。
 */
class InjectPcmProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<String>?,
        selection: String?,
        selectionArgs: Array<String>?,
        sortOrder: String?
    ): Cursor? {
        if (uri.path != "/status") return null
        val ctx = context ?: return null
        if (!callerAllowed(ctx)) return null
        // 有人来问 = 注入模块还活着。没 root 的手机永远不会走到这里。
        InjectPcmStore.markModuleContact()
        val state = InjectPcmStore.state(ctx)
        val cursor = MatrixCursor(
            arrayOf("ready", "rate", "channels", "bytes", "generation", "consumed", "at")
        )
        cursor.addRow(
            arrayOf(
                if (state.ready) 1 else 0,
                state.rate,
                state.channels,
                state.bytes,
                state.generation,
                if (state.consumed) 1 else 0,
                state.publishedAtMillis
            )
        )
        return cursor
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        if (uri.path != "/pcm") return null
        val ctx = context ?: return null
        if (!callerAllowed(ctx)) return null
        val target = InjectPcmStore.file(ctx)
        if (!target.exists() || target.length() <= 0L) return null
        return ParcelFileDescriptor.open(target, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun call(method: String, arg: String?, extras: android.os.Bundle?): android.os.Bundle? {
        val ctx = context ?: return null
        if (!callerAllowed(ctx)) return null
        return when (method) {
            "consume" -> {
                val generation = arg?.toLongOrNull() ?: return null
                android.os.Bundle().apply {
                    putBoolean("ok", InjectPcmStore.consume(ctx, generation))
                }
            }
            "clear" -> {
                InjectPcmStore.clear(ctx)
                android.os.Bundle().apply { putBoolean("ok", true) }
            }
            else -> null
        }
    }

    /** 只允许 Soul 进程读写；同应用（本进程）也放行。 */
    private fun callerAllowed(ctx: Context): Boolean {
        val uid = Binder.getCallingUid()
        if (uid == Process.myUid()) return true
        val packages = ctx.packageManager.getPackagesForUid(uid) ?: return false
        return packages.any { it == SOUL_PACKAGE }
    }

    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0
    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<String>?
    ): Int = 0

    companion object {
        const val SOUL_PACKAGE = "cn.soulapp.android"
    }
}

/** 给注入模块侧用的一个小工具：把"多久算太久"之类的判断集中在一处，方便单测。 */
object InjectTimingPolicy {
    /** 模块轮询发布状态的间隔。 */
    const val POLL_INTERVAL_MS = 400L

    /** 配音用完（或作废）后，隔多久允许接受下一段。 */
    const val RELOAD_COOLDOWN_MS = 800L

    /**
     * 已经加载的那段配音还算数吗。
     * [armedAtUptimeMillis] 是加载时刻（开机计时），避免系统改时间导致误判。
     */
    fun stillValid(
        armedGeneration: Long,
        currentGeneration: Long,
        armedAtUptimeMillis: Long,
        nowUptimeMillis: Long
    ): Boolean {
        if (armedGeneration != currentGeneration) return false
        val age = nowUptimeMillis - armedAtUptimeMillis
        return age in 0..InjectPcmStore.TTL_MS
    }

    fun uptimeNow(): Long = SystemClock.elapsedRealtime()
}
