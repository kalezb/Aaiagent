package com.aaiagent

import com.aaiagent.adapter.PlatformAdapter.ChatMessage
import com.aaiagent.engine.PendingTopicPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingTopicPolicyTest {
    @Test
    fun `same schedule topic merges into one latest item`() {
        val plan = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "明天几点起来", "text"),
                ChatMessage("other", "起床后跟我说一声", "text")
            )
        )!!

        assertEquals(1, plan.items.size)
        assertEquals(PendingTopicPolicy.TopicKind.SCHEDULE, plan.items.single().kind)
        assertTrue(plan.items.single().sourceCount == 2)
        assertTrue(plan.prompt().contains("同话题2条合并"))
    }

    @Test
    fun `different questions are latest first and limited to three`() {
        val plan = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "周末有空吗", "text"),
                ChatMessage("other", "你吃饭了吗", "text"),
                ChatMessage("other", "明天几点起来", "text"),
                ChatMessage("other", "你工作是什么", "text")
            )
        )!!

        assertEquals(3, plan.items.size)
        assertTrue(plan.items[0].text.contains("工作"))
        assertTrue(plan.items[1].text.contains("几点"))
        assertTrue(plan.items[2].text.contains("吃饭"))
        assertTrue(plan.prompt().contains("先处理第1项"))
    }

    @Test
    fun `trivial acknowledgements do not become pending work`() {
        val plan = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "嗯", "text"),
                ChatMessage("other", "？", "text"),
                ChatMessage("other", "在吗", "text"),
                ChatMessage("other", "人呢", "text")
            )
        )

        assertNull(plan)
    }

    @Test
    fun `affection and intimate escalation are classified separately`() {
        val affection = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "你今天真好看", "text"),
                ChatMessage("other", "想你了", "text")
            )
        )!!
        assertEquals(PendingTopicPolicy.TopicKind.AFFECTION, affection.items.single().kind)

        val suggestive = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "让我检查一下你有没有洗干净", "text"),
                ChatMessage("other", "过来陪陪我", "text")
            )
        )!!
        assertEquals(PendingTopicPolicy.TopicKind.SUGGESTIVE_BOUNDARY, suggestive.items.single().kind)

        val explicit = PendingTopicPolicy.build(
            listOf(
                ChatMessage("other", "你还没回我", "text"),
                ChatMessage("other", "发张照片看看", "text")
            )
        )!!
        assertEquals(PendingTopicPolicy.TopicKind.EXPLICIT_BOUNDARY, explicit.items.first().kind)
    }
}
