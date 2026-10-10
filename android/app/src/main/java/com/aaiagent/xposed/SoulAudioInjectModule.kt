package com.aaiagent.xposed

import android.app.AndroidAppHelper
import android.app.Application
import android.content.Context
import android.media.AudioRecord
import android.net.Uri
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage
import java.nio.ByteBuffer
import java.util.Arrays

/** Soul 的包名。真机实测录音发生在主进程，所以只挂主进程。 */
private const val SOUL_PACKAGE_NAME = "cn.soulapp.android"

/**
 * 把 Fish Audio 配音注入 Soul 录音流的 LSPosed 模块。
 *
 * 它**跑在 Soul 的进程里**：改写 `AudioRecord`，让 Soul 以为麦克风收到的
 * 就是我们准备好的配音。不走扬声器，所以没有回声。
 *
 * 为什么只改这一处：真机实测（2026-10-06）确认 Soul 走的是 Java 层
 * `android.media.AudioRecord`，`source=MIC(1) rate=16000 ch=1 线程=main`，
 * 所以 Java 层 Hook 是有效的。
 *
 * 只挂 **Soul 主进程**：录音发生在主进程（真机日志 pid 与主进程一致），
 * 挂到推送之类子进程只会白白添乱、还会抛空指针。
 */
class SoulAudioInjectModule : IXposedHookLoadPackage {

    override fun handleLoadPackage(lpparam: XC_LoadPackage.LoadPackageParam) {
        // 第一行就记日志：万一后面哪一步抛了异常，也看得出模块到底有没有被调起来。
        XposedBridge.log(
            "AiaAgent: handleLoadPackage pkg=${lpparam.packageName} process=${lpparam.processName}"
        )
        if (lpparam.packageName != SOUL_PACKAGE_NAME) return
        val process = lpparam.processName.orEmpty()
        if (process.isNotEmpty() && process != SOUL_PACKAGE_NAME) return

        XposedBridge.log("AiaAgent: 挂上 ${lpparam.packageName} 进程=$process")
        hookAppContext()
        hookAudioRecord()
        Injector.startPoller()
        XposedBridge.log("AiaAgent: 初始化完成")
    }

    /**
     * 抓住进程的 Application，后面用 ContentResolver 去取配音。
     *
     * 注意用 `param.thisObject` 自己当 Context，不要调 getApplicationContext() ——
     * 后者在这个时机可能还是 null（FishVoice 就在这儿抛过空指针）。
     */
    private fun hookAppContext() {
        try {
            XposedHelpers.findAndHookMethod(
                Application::class.java,
                "attach",
                Context::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        HostContext.set(param.thisObject as? Application)
                    }
                }
            )
        } catch (t: Throwable) {
            XposedBridge.log("AiaAgent: hook Application.attach 失败 :: $t")
        }
    }

    private fun hookAudioRecord() {
        hookAfter("startRecording") { param ->
            val record = param.thisObject as? AudioRecord ?: return@hookAfter
            val rate = runCatching { record.sampleRate }.getOrDefault(16_000)
            val channels = runCatching { record.channelCount }.getOrDefault(1)
            Injector.onStart(rate, channels)
        }
        hookAfter("stop") { Injector.onStop() }
        hookAfter("release") { Injector.onStop() }

        val intType = java.lang.Integer.TYPE

        // read(byte[], int, int)
        hookRead(listOf<Class<*>>(ByteArray::class.java, intType, intType)) { param ->
            val dest = param.args[0] as? ByteArray ?: return@hookRead
            val offset = param.args[1] as Int
            val size = param.args[2] as Int
            val written = Injector.injectBytes(dest, offset, size)
            if (written >= 0) param.result = written
        }

        // read(byte[], int, int, int) —— 第 4 个参数是 readMode，不是偏移量。
        hookRead(listOf<Class<*>>(ByteArray::class.java, intType, intType, intType)) { param ->
            val dest = param.args[0] as? ByteArray ?: return@hookRead
            val offset = param.args[1] as Int
            val size = param.args[2] as Int
            val written = Injector.injectBytes(dest, offset, size)
            if (written >= 0) param.result = written
        }

        // read(short[], int, int)
        hookRead(listOf<Class<*>>(ShortArray::class.java, intType, intType)) { param ->
            val dest = param.args[0] as? ShortArray ?: return@hookRead
            val offset = param.args[1] as Int
            val size = param.args[2] as Int
            val written = Injector.injectShorts(dest, offset, size)
            if (written >= 0) param.result = written
        }

        // read(ByteBuffer, int)
        // 注意：官方签名第二个参数是 sizeInBytes，**不能**当成偏移量
        // （FishVoice 就是当成偏移量了，所以它的 ByteBuffer 路径一直没生效）。
        hookRead(listOf<Class<*>>(ByteBuffer::class.java, intType)) { param ->
            val dest = param.args[0] as? ByteBuffer ?: return@hookRead
            val size = param.args[1] as Int
            val written = Injector.injectBuffer(dest, size)
            if (written >= 0) param.result = written
        }

        // read(ByteBuffer, int, int) —— 第三个参数是 readMode，同样不是偏移量。
        hookRead(listOf<Class<*>>(ByteBuffer::class.java, intType, intType)) { param ->
            val dest = param.args[0] as? ByteBuffer ?: return@hookRead
            val size = param.args[1] as Int
            val written = Injector.injectBuffer(dest, size)
            if (written >= 0) param.result = written
        }
    }

    private fun hookAfter(name: String, body: (XC_MethodHook.MethodHookParam) -> Unit) {
        try {
            XposedHelpers.findAndHookMethod(
                AudioRecord::class.java,
                name,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) = body(param)
                }
            )
        } catch (t: Throwable) {
            XposedBridge.log("AiaAgent: hook $name 失败 :: $t")
        }
    }

    private fun hookRead(
        types: List<Class<*>>,
        body: (XC_MethodHook.MethodHookParam) -> Unit
    ) {
        try {
            val args = arrayOfNulls<Any>(types.size + 1)
            types.forEachIndexed { index, type -> args[index] = type }
            args[types.size] = object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) = body(param)
            }
            XposedHelpers.findAndHookMethod(AudioRecord::class.java, "read", *args)
        } catch (t: Throwable) {
            XposedBridge.log("AiaAgent: hook read(${types.joinToString { it.name }}) 失败 :: $t")
        }
    }
}

/** 进程的 Application，用来访问 ContentResolver。 */
private object HostContext {
    @Volatile
    private var application: Application? = null

    fun set(app: Application?) {
        application = app
    }

    fun get(): Context? = application ?: runCatching { AndroidAppHelper.currentApplication() }.getOrNull()
}

/**
 * 注入的核心：把配音按真实播放速度喂给 Soul 的每一次读。
 *
 * **一次性**：一段配音只会被用掉一次，用掉就丢，避免旧配音被下一次手动录音误用。
 */
private object Injector {

    private const val CANONICAL_RATE = 16_000
    private const val CANONICAL_CHANNELS = 1

    @Volatile
    private var recording = false

    @Volatile
    private var pcm: ByteArray? = null

    @Volatile
    private var rate = CANONICAL_RATE

    @Volatile
    private var channels = CANONICAL_CHANNELS

    @Volatile
    private var armedGeneration = -1L

    @Volatile
    private var armedAtUptime = 0L

    @Volatile
    private var consumedGeneration = -1L

    @Volatile
    private var pollerStarted = false

    /**
     * 本次录音是否已经把配音挂上去了。
     *
     * 用来避免"录音中途配音才到"时重复挂载、重复打日志、重复标记消费。
     */
    @Volatile
    private var armedThisSession = false

    private val paceLock = Any()
    private var cursor = 0
    private var nextDeadlineNanos = 0L

    /** 后台轮询"有没有新配音要注入"，提前加载好，避免录音开始时才去取（会来不及）。 */
    fun startPoller() {
        if (pollerStarted) return
        pollerStarted = true
        Thread {
            while (true) {
                runCatching { pollOnce() }
                try {
                    Thread.sleep(InjectTimingPolicy.POLL_INTERVAL_MS)
                } catch (_: InterruptedException) {
                }
            }
        }.apply {
            isDaemon = true
            name = "AiaAgentInjectPoller"
        }.start()
    }

    private fun pollOnce() {
        val context = HostContext.get() ?: return
        val state = readState(context) ?: return
        if (!state.ready) return
        if (state.generation == consumedGeneration) return
        val now = InjectTimingPolicy.uptimeNow()
        if (pcm != null && InjectTimingPolicy.stillValid(
                armedGeneration, state.generation, armedAtUptime, now
            )
        ) {
            return
        }
        val bytes = readPcm(context) ?: return
        if (bytes.isEmpty()) return
        synchronized(paceLock) {
            pcm = bytes
            cursor = 0
            rate = state.rate
            channels = state.channels
            armedGeneration = state.generation
            armedAtUptime = now
            nextDeadlineNanos = System.nanoTime()
        }
        XposedBridge.log(
            "AiaAgent: 配音已就绪 gen=${state.generation} bytes=${bytes.size} " +
                "rate=${state.rate} ch=${state.channels}"
        )

        // **录音已经开始了、但刚才配音还没到** —— 现在补挂上去，否则这次录音会全是静音。
        if (InjectArmPolicy.shouldArmOnLoad(recording, armedThisSession)) {
            XposedBridge.log("AiaAgent: 录音进行中，补挂配音")
            arm(bytes)
        }
    }

    fun onStart(sampleRate: Int, channelCount: Int) {
        if (sampleRate != CANONICAL_RATE || channelCount != CANONICAL_CHANNELS) {
            // 格式对不上就别注入：直接塞进去会变调、变速。
            XposedBridge.log("AiaAgent: Soul 录音格式 rate=$sampleRate ch=$channelCount 与配音不符，不注入")
            recording = false
            return
        }
        recording = true
        armedThisSession = false

        // **配音可能还没被轮询线程取到 —— 这时绝不能放弃。**
        //
        // 真机实测（2026-10-06 18:16）：应用发布配音（18:16:43.490）到模块取到
        // （18:16:43.853）之间差了约 250ms，而 Soul 的 startRecording 正好落在这条缝里。
        // 原来这里直接 return，结果整段录音全是静音 —— 而且**没有任何日志**，
        // 表现就是"语音发出去了但没声音"，非常难查。
        // 正确做法：先记下"正在录音"，等轮询线程取到配音时再补挂上去（见 pollOnce）。
        val loaded = pcm
        if (InjectArmPolicy.shouldWaitForPcm(recording, loaded != null)) {
            XposedBridge.log("AiaAgent: 已开始录音，配音还没到，等它到了再注入")
            return
        }
        loaded?.let { arm(it) }
    }

    /** 把配音挂到当前这次录音上：重置游标、标记已消费、留下日志。 */
    private fun arm(loaded: ByteArray) {
        val now = InjectTimingPolicy.uptimeNow()
        if (!InjectTimingPolicy.stillValid(armedGeneration, armedGeneration, armedAtUptime, now)) {
            XposedBridge.log("AiaAgent: 配音已过期（超过 TTL），丢弃 ${loaded.size} 字节")
            pcm = null
            recording = false
            return
        }
        synchronized(paceLock) {
            cursor = 0
            nextDeadlineNanos = System.nanoTime()
        }
        recording = true
        armedThisSession = true
        markConsumed()
        XposedBridge.log("AiaAgent: 开始注入 ${loaded.size} 字节")
    }

    fun onStop() {
        recording = false
        armedThisSession = false
        synchronized(paceLock) {
            cursor = 0
            pcm = null
        }
    }

    fun injectBytes(dest: ByteArray, offset: Int, size: Int): Int {
        if (!ready()) return -1
        val source = pcm ?: return -1
        val start = offset.coerceIn(0, dest.size)
        val max = size.coerceAtMost(dest.size - start).coerceAtLeast(0)
        if (max <= 0) return 0
        var written = 0
        synchronized(paceLock) {
            while (written < max) {
                val remaining = source.size - cursor
                if (remaining <= 0) break
                val n = minOf(remaining, max - written)
                System.arraycopy(source, cursor, dest, start + written, n)
                cursor += n
                written += n
            }
            if (written < max) {
                // 配音放完了就补静音：绝不把真实环境音漏出去。
                Arrays.fill(dest, start + written, start + max, 0)
                written = max
            }
            pace(max)
        }
        return written
    }

    fun injectShorts(dest: ShortArray, offset: Int, size: Int): Int {
        if (!ready()) return -1
        val source = pcm ?: return -1
        val start = offset.coerceIn(0, dest.size)
        val max = size.coerceAtMost(dest.size - start).coerceAtLeast(0)
        if (max <= 0) return 0
        var written = 0
        synchronized(paceLock) {
            while (written < max && cursor + 1 < source.size) {
                val lo = source[cursor].toInt() and 0xFF
                val hi = source[cursor + 1].toInt() and 0xFF
                dest[start + written] = (lo or (hi shl 8)).toShort()
                cursor += 2
                written += 1
            }
            if (written < max) {
                for (i in start + written until start + max) dest[i] = 0
                written = max
            }
            pace(max * 2)
        }
        return written
    }

    fun injectBuffer(dest: ByteBuffer, size: Int): Int {
        if (!ready()) return -1
        val source = pcm ?: return -1
        val max = size.coerceAtMost(dest.remaining()).coerceAtLeast(0)
        if (max <= 0) return 0
        var written = 0
        synchronized(paceLock) {
            while (written < max) {
                val remaining = source.size - cursor
                if (remaining <= 0) break
                val n = minOf(remaining, max - written)
                dest.put(source, cursor, n)
                cursor += n
                written += n
            }
            while (written < max) {
                dest.put(0)
                written += 1
            }
            pace(max)
        }
        return written
    }

    private fun ready(): Boolean = recording && (pcm?.size ?: 0) > 0

    /**
     * 按真实播放速度等待，不然 Soul 会拿到一个"超快的数据流"，声音就毁了。
     * 绝对时间线累加（nextDeadlineNanos），避免每次 sleep 的误差累积。
     */
    private fun pace(bytes: Int) {
        if (bytes <= 0 || rate <= 0 || channels <= 0) return
        val frames = (bytes / (2 * channels)).coerceAtLeast(0)
        val frameNanos = frames * 1_000_000_000L / rate
        nextDeadlineNanos += frameNanos
        val wait = nextDeadlineNanos - System.nanoTime()
        if (wait > 0) {
            try {
                Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
            } catch (_: InterruptedException) {
            }
        }
    }

    private fun markConsumed() {
        val context = HostContext.get() ?: return
        val generation = armedGeneration
        if (generation < 0L || generation == consumedGeneration) return
        consumedGeneration = generation
        runCatching {
            context.contentResolver.call(
                Uri.parse("content://${InjectPcmStore.AUTHORITY}"),
                "consume",
                generation.toString(),
                null
            )
        }
    }

    private fun readState(context: Context): InjectPcmStore.State? {
        return runCatching {
            context.contentResolver.query(
                Uri.parse("content://${InjectPcmStore.AUTHORITY}/status"),
                null, null, null, null
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                InjectPcmStore.State(
                    ready = cursor.getInt(0) == 1,
                    rate = cursor.getInt(1),
                    channels = cursor.getInt(2),
                    bytes = cursor.getLong(3),
                    generation = cursor.getLong(4),
                    consumed = cursor.getInt(5) == 1,
                    publishedAtMillis = cursor.getLong(6)
                )
            }
        }.getOrNull()
    }

    private fun readPcm(context: Context): ByteArray? {
        return runCatching {
            context.contentResolver.openInputStream(
                Uri.parse("content://${InjectPcmStore.AUTHORITY}/pcm")
            )?.use { it.readBytes() }
        }.getOrNull()
    }
}
