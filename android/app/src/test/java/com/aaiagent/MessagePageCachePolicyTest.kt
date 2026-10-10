package com.aaiagent

import com.aaiagent.engine.MessagePageCachePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagePageCachePolicyTest {

    @Test
    fun `签名一致才复用`() {
        assertTrue(MessagePageCachePolicy.shouldReuse("soul|8|2|好棒", "soul|8|2|好棒"))
        assertFalse(MessagePageCachePolicy.shouldReuse("soul|8|2|好棒", "soul|9|2|好棒"))
    }

    @Test
    fun `拿不到签名一律不复用，宁可慢也不拿旧数据糊弄`() {
        // 页面没加载完 / 找不到消息条目时签名是 null，这时必须全量解析。
        assertFalse(MessagePageCachePolicy.shouldReuse(null, "soul|8|2|好棒"))
        assertFalse(MessagePageCachePolicy.shouldReuse("soul|8|2|好棒", null))
        assertFalse(MessagePageCachePolicy.shouldReuse(null, null))
        assertFalse(MessagePageCachePolicy.shouldReuse("", ""))
        assertFalse(MessagePageCachePolicy.shouldReuse("soul|8|2|好棒", ""))
    }

    @Test
    fun `第一次读没有缓存，不能复用`() {
        assertFalse(MessagePageCachePolicy.shouldReuse(null, "soul|1|0|在吗"))
    }
}