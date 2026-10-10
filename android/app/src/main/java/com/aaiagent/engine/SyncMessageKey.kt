package com.aaiagent.engine

object SyncMessageKey {
    fun build(
        platform: String,
        contactId: String,
        role: String,
        content: String,
        sequence: Long,
        createdAt: Long? = null,
        stableKey: String? = null,
    ): String {
        // 2026-10-06 真机（稀奇）：同一条消息被同步了两次、两次生成的 key 不一样，
        // 后端去重失效，历史里同一句话出现两三遍，模型越看越乱、回复也开始不合逻辑。
        // 原因是这里回退用了 sequence：它每次同步都会往前走，同一条消息就拿不到同一个 key。
        // 现在只用稳定的时间锚点；都没有时就用“角色+内容”，宁可合并真正的重复，也不要造重复历史。
        //
        // 2026-10-07 又一次真机（不期而遇 / 卡卡罗特）：整段对话被重新入库了一遍 ——
        // 00:16~00:22 的 6 条消息，在 00:51:30 这一秒里全部又出现一次，每条都拿到新 key。
        // 这次漂移的是 createdAt：它由页面的**相对**时间标签（“刚刚”“5分钟前”）解析而来，
        // 隔一段时间重读同一句话会解析出不同的绝对时间，于是指纹变了、key 也变了。
        // 跟上次的 sequence 是同一个坑换了个入口。
        //
        // 结论：锚点只认 stableKey，它由“角色+类型+内容”构成、跨多次读取稳定。
        // createdAt 参数保留是为了不动调用方，但**故意不参与指纹**。
        val timeAnchor = stableKey?.trim().orEmpty()
        // 语音的转写文字是后补的：内容会从 [语音] 变成“对方语音转文字：...”，
        // 但数据库里必须是同一条消息，靠同一个 key 补 transcript，不能新增一条。
        val contentAnchor = if (timeAnchor.contains("\u001Fvoice\u001F")) {
            "[语音]"
        } else {
            content.trim()
        }
        val fingerprint = listOf(role, contentAnchor, timeAnchor).joinToString("\u001f")
        return "sync:${platform.trim()}:${contactId.trim()}:${fnv1a(fingerprint)}".take(220)
    }

    private fun fnv1a(value: String): String {
        var hash = 2166136261u
        value.forEach { character ->
            hash = hash xor character.code.toUInt()
            hash *= 16777619u
        }
        return hash.toString(36)
    }
}
