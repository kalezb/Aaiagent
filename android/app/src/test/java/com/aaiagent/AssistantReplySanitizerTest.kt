package com.aaiagent

import com.aaiagent.engine.AssistantReplySanitizer
import org.junit.Assert.assertEquals
import org.junit.Test

class AssistantReplySanitizerTest {
    @Test
    fun `removes leaked speaker markers from every reply segment`() {
        val raw = "给谁 你对象啊\n你说：我眯了啊 明天还一堆单子\n你说：明天还得跑单子"

        assertEquals(
            "给谁 你对象啊\n我眯了啊 明天还一堆单子\n明天还得跑单子",
            AssistantReplySanitizer.clean(raw)
        )
    }

    @Test
    fun `removes leaked timestamp and speaker prefixes`() {
        val raw = "[22:15] 你说：大半夜不睡觉整这个\n[09/25 03:40] 明天还得跑单子"

        assertEquals(
            "大半夜不睡觉整这个\n明天还得跑单子",
            AssistantReplySanitizer.clean(raw)
        )
    }

    @Test
    fun `keeps ordinary conversational uses of speaker words`() {
        assertEquals(
            "你说呢 我还在看消息\n我说真的 没骗你",
            AssistantReplySanitizer.clean("你说呢 我还在看消息\n我说真的 没骗你")
        )
    }

    @Test
    fun `also accepts pipe separated model output`() {
        assertEquals(
            "在的\n刚忙完\n晚点聊",
            AssistantReplySanitizer.clean("在的|||你说：刚忙完|||[23:10] 晚点聊")
        )
    }
}
