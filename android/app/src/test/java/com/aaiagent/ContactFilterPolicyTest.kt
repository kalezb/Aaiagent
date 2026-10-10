package com.aaiagent

import com.aaiagent.engine.ContactFilterPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactFilterPolicyTest {
    @Test
    fun `empty whitelist allows any non-blacklisted contact`() {
        assertTrue(ContactFilterPolicy.allowsContact("期待下一步的我们", "期待下一步的我们", emptyList(), emptyList()))
    }

    @Test
    fun `non-empty whitelist allows only listed contacts`() {
        val whitelist = listOf("期待下一步的我们")

        assertTrue(ContactFilterPolicy.allowsContact("期待下一步的我们", "id-1", whitelist, emptyList()))
        assertFalse(ContactFilterPolicy.allowsContact("其他联系人", "id-2", whitelist, emptyList()))
    }

    @Test
    fun `blacklist always wins over whitelist and empty whitelist`() {
        assertFalse(ContactFilterPolicy.allowsContact("广告账号", "id-3", emptyList(), listOf("广告账号")))
        assertFalse(
            ContactFilterPolicy.allowsContact(
                "广告账号",
                "id-3",
                listOf("广告账号"),
                listOf("广告账号")
            )
        )
    }

    @Test
    fun `matching ignores spaces zero width characters case and trailing ellipsis`() {
        val whitelist = listOf("期待下一步的我们…")

        assertTrue(ContactFilterPolicy.allowsContact("期待 下一步的我们\u200B", "id-4", whitelist, emptyList()))
        assertTrue(ContactFilterPolicy.allowsContact("Alice", "id-5", listOf("alice"), emptyList()))
    }

    @Test
    fun `contact id can satisfy the filter when displayed name has decoration`() {
        assertTrue(
            ContactFilterPolicy.allowsContact(
                "期待下一步的我们✨",
                "期待下一步的我们",
                listOf("期待下一步的我们"),
                emptyList()
            )
        )
    }
}
