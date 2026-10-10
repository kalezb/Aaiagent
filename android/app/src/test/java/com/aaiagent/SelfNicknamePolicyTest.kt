package com.aaiagent

import com.aaiagent.engine.SelfNicknamePolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class SelfNicknamePolicyTest {

    @Test
    fun `每个平台各存一个键，互不覆盖`() {
        assertEquals("self_nickname_soul", SelfNicknamePolicy.configKey("soul"))
        assertEquals("self_nickname_qq", SelfNicknamePolicy.configKey("qq"))
        assertEquals("self_nickname_soul", SelfNicknamePolicy.configKey(" SOUL "))
    }

    @Test
    fun `平台为空时退化成基础键，老数据还能读`() {
        assertEquals("self_nickname", SelfNicknamePolicy.configKey(""))
        assertEquals("self_nickname", SelfNicknamePolicy.configKey("   "))
    }

    @Test
    fun `清洗换行和制表符，避免提示词被撑开`() {
        assertEquals("另一面的我", SelfNicknamePolicy.normalize("  另一面的我  "))
        assertEquals("第一行 第二行", SelfNicknamePolicy.normalize("第一行\n第二行"))
        assertEquals("A B", SelfNicknamePolicy.normalize("A\r\n\tB"))
    }

    @Test
    fun `超长昵称按上限截断，和走后端的长度一致`() {
        val long = "名".repeat(SelfNicknamePolicy.MAX_LENGTH + 20)
        assertEquals(SelfNicknamePolicy.MAX_LENGTH, SelfNicknamePolicy.normalize(long).length)
    }

    @Test
    fun `没填就是空串，后端那段提示词自然不出现`() {
        assertEquals("", SelfNicknamePolicy.forRequest(null))
        assertEquals("", SelfNicknamePolicy.forRequest("   "))
        assertEquals("另一面的我", SelfNicknamePolicy.forRequest(" 另一面的我 "))
    }
}
