package com.aaiagent.engine

/**
 * 聊天页解析结果的复用判定。
 *
 * 背景（真机实测 2026-10-07）：读一次 7~9 条的聊天页要 2.8~4.0 秒，而一次回复
 * 总共要读 6~15 次（1 段读 6 次，2 段读 11~15 次）。这些读里大半读的是同一个
 * 没变过的页面，纯属白读。
 *
 * 判定刻意保守：**只有签名拿得到、而且和上次一模一样时才复用**。
 * 签名拿不到（页面没加载完、找不到消息条目）一律走全量解析 ——
 * 宁可慢一点，也绝不能拿旧数据去糊弄收发方向判定。
 */
object MessagePageCachePolicy {
    fun shouldReuse(cachedSignature: String?, currentSignature: String?): Boolean {
        if (cachedSignature.isNullOrEmpty()) return false
        if (currentSignature.isNullOrEmpty()) return false
        return cachedSignature == currentSignature
    }
}