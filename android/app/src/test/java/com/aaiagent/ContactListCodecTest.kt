package com.aaiagent

import com.aaiagent.data.repository.ContactListCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContactListCodecTest {
    @Test
    fun `normalize trims removes blanks and deduplicates`() {
        val result = ContactListCodec.normalize(
            listOf("  期待下一步的我们  ", "", "   ", "期待下一步的我们", "另一个联系人")
        )

        assertEquals(listOf("期待下一步的我们", "另一个联系人"), result)
    }

    @Test
    fun `encode and decode round trip keeps normalized list`() {
        val encoded = ContactListCodec.encode(listOf(" 小明 ", "小明", "小红"))

        assertEquals(listOf("小明", "小红"), ContactListCodec.decode(encoded))
    }

    @Test
    fun `invalid or blank json is treated as empty list`() {
        assertTrue(ContactListCodec.decode(null).isEmpty())
        assertTrue(ContactListCodec.decode("").isEmpty())
        assertTrue(ContactListCodec.decode("not-json").isEmpty())
    }
}
