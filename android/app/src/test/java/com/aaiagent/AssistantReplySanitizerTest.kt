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
    fun `removes speaker labels leaked into the middle of a reply`() {
        assertEquals(
            "这话我记下了 胃里还烧着吗",
            AssistantReplySanitizer.clean("这话我记下了我：胃里还烧着吗")
        )
        assertEquals(
            "胃里还烧着吗",
            AssistantReplySanitizer.clean("我：胃里还烧着吗")
        )
    }

    @Test
    fun `also accepts pipe separated model output`() {
        assertEquals(
            "在的\n刚忙完\n晚点聊",
            AssistantReplySanitizer.clean("在的|||你说：刚忙完|||[23:10] 晚点聊")
        )
    }

    @Test
    fun `removes leaked dated context markers from the middle of a reply`() {
        val raw = "位置就算了，才聊几天就互换地址太快了 [soul 10/01 18:57] 你也是急性子，见面的事先放放吧"

        assertEquals(
            "位置就算了，才聊几天就互换地址太快了 你也是急性子，见面的事先放放吧",
            AssistantReplySanitizer.clean(raw)
        )
    }

    @Test
    fun `keeps ordinary bracketed expressions`() {
        assertEquals(
            "好烦[笑哭] 晚点再聊",
            AssistantReplySanitizer.clean("好烦[笑哭] 晚点再聊")
        )
    }

    @Test
    fun `removes doubled media placeholders the model copied from context`() {
        // 实测踩到的坑：上下文里自己的语音写作 [语音] 说了什么，
        // 模型把这个格式当成要模仿的写法照抄，发出去时又加了一个前缀，
        // 结果变成 [语音] [语音] 错怪不怪我不管...
        assertEquals(
            "错怪不怪我不管 你倒是说说想听什么呀",
            AssistantReplySanitizer.clean("[语音] [语音] 错怪不怪我不管 你倒是说说想听什么呀")
        )
    }

    @Test
    fun `removes a single leading media placeholder`() {
        assertEquals("在的呀", AssistantReplySanitizer.clean("[语音] 在的呀"))
        assertEquals("发你了", AssistantReplySanitizer.clean("[图片] 发你了"))
    }

    @Test
    fun `removes media placeholders at every segment start`() {
        assertEquals(
            "在的\n刚忙完",
            AssistantReplySanitizer.clean("[语音] 在的\n[图片] 刚忙完")
        )
    }

    @Test
    fun `keeps the word voice when it is not a placeholder`() {
        // 正文里正常提到"语音"两个字，不能被当成占位符削掉。
        assertEquals(
            "我给你发语音吧 打字太慢",
            AssistantReplySanitizer.clean("我给你发语音吧 打字太慢")
        )
    }

    // ---- 内部标记绝不能发出去（用户要求：100%，漏一个就是穿帮）----

    /**
     * **每一个内部标记单独出现时，都必须被清成空。**
     *
     * 清成空之后 `sendReply` 会判空、整条拦下 —— 这就是"绝不发出去"的实现方式。
     * 这条用例直接遍历清单，所以以后往清单里加了新标记会**自动**被覆盖到。
     */
    @Test
    fun `every internal marker on its own is wiped out`() {
        for (marker in AssistantReplySanitizer.INTERNAL_MARKERS) {
            assertEquals("标记 $marker 必须被清空", "", AssistantReplySanitizer.clean(marker))
            assertEquals("标记 $marker 必须被清空", "", AssistantReplySanitizer.clean("  $marker  "))
            assertEquals("标记 $marker 必须被清空", "", AssistantReplySanitizer.clean("$marker\n$marker"))
        }
        // 清单本身不能是空的 —— 否则上面那个循环会"全过"但其实什么都没测。
        assertEquals(true, AssistantReplySanitizer.INTERNAL_MARKERS.size >= 15)
    }

    /**
     * 带参数的标记（真机上换图那条路会碰到）。
     *
     * 后端"待发媒体"时返回的回复就是 `[图片:daily_04]` —— 这是内部记号，
     * 不是人说的话。旧过滤只认 `[图片]` 这种空形式，**完全挡不住它**。
     */
    @Test
    fun `parameterized media markers are wiped out too`() {
        assertEquals("", AssistantReplySanitizer.clean("[图片:daily_04]"))
        assertEquals("", AssistantReplySanitizer.clean("[图片：daily_04]"))   // 全角冒号
        assertEquals("", AssistantReplySanitizer.clean("[图片: daily_04]"))  // 带空格
        assertEquals("", AssistantReplySanitizer.clean("[语音:abc123]"))
        assertEquals("", AssistantReplySanitizer.clean("[视频:clip_01]"))
    }

    /**
     * 标记混在正常文字里 —— 剔掉标记、**正常的话照发**。
     * 不能因为怕穿帮就把整条回复也丢了（那她就不说话了）。
     */
    @Test
    fun `internal markers inside a real sentence are stripped but the words survive`() {
        assertEquals(
            "我今天挺开心的 你觉得呢",
            AssistantReplySanitizer.clean("我今天挺开心的 [图片] 你觉得呢")
        )
        assertEquals(
            "喏 给你看看",
            AssistantReplySanitizer.clean("喏 [图片:daily_04] 给你看看")
        )
        assertEquals(
            "这个不错",
            AssistantReplySanitizer.clean("[以图换图] 这个不错"))
    }

    /**
     * 反向保护：普通方括号内容**不许**被误伤。
     * 客人发"【重点】"、模型写"[笑哭]"这类，都是正常表达。
     */
    @Test
    fun `ordinary bracketed text is never touched`() {
        assertEquals("【重点】明天记得带伞", AssistantReplySanitizer.clean("【重点】明天记得带伞"))
        assertEquals("好烦[笑哭] 晚点再聊", AssistantReplySanitizer.clean("好烦[笑哭] 晚点再聊"))
        assertEquals("[重要] 别忘了", AssistantReplySanitizer.clean("[重要] 别忘了"))
        // 只是提到了"图片"两个字，不是标记。
        assertEquals("你发的图片我看了", AssistantReplySanitizer.clean("你发的图片我看了"))
    }
}
