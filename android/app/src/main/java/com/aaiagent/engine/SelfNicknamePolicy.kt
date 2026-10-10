package com.aaiagent.engine

/**
 * 本机当前平台账号的昵称，由用户手填。
 *
 * 为什么只能手填：自己的昵称只出现在 Soul「我的」页面，聊天页里看不到自己的名字；
 * 而每台设备、每个账号的昵称都不一样，自动去读还会因为改版、页面没加载完、
 * 误进别人主页而读成别人的名字。所以这里以手填为准，按平台分开存，只存本机。
 *
 * 值为空就代表"没填"，后端那段「当前平台账号昵称」提示词自然不出现。
 */
object SelfNicknamePolicy {
    /** 配置表的键前缀。每个平台一个键，换平台不会互相覆盖。 */
    const val BASE_KEY = "self_nickname"

    /** 昵称长度上限，和后端 route.ts 里的截断长度保持一致。 */
    const val MAX_LENGTH = 40

    /** 平台为空时退化成不带后缀的旧键，保证老数据还能读出来。 */
    fun configKey(platform: String): String {
        val normalized = platform.trim().lowercase()
        return if (normalized.isEmpty()) BASE_KEY else "$BASE_KEY" + "_" + normalized
    }

    /** 存之前统一清洗：换行制表符压成空格、去首尾空格、限长。 */
    fun normalize(value: String?): String = value.orEmpty()
        .replace(Regex("[\\r\\n\\t]+"), " ")
        .trim()
        .take(MAX_LENGTH)

    /** 送给后端的就是清洗后的值；空串代表没填。 */
    fun forRequest(value: String?): String = normalize(value)
}
