package com.aaiagent

import com.aaiagent.adapter.SoulNodeHierarchy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SoulNodeHierarchyTest {
    private data class Node(
        val id: String?,
        val parent: Node? = null
    )

    @Test
    fun `new Soul unread badge resolves its own item_content_root ancestor`() {
        val item = Node("cn.soulapp.android:id/item_content_root")
        val messageContainer = Node("cn.soulapp.android:id/messageContainer", item)
        val badge = Node("cn.soulapp.android:id/unread_msg_number", messageContainer)

        val found = SoulNodeHierarchy.findIncludingSelf(
            start = badge,
            parentOf = { it.parent },
            viewIdOf = { it.id },
            targetViewId = "cn.soulapp.android:id/item_content_root"
        )

        assertEquals(item, found)
    }

    @Test
    fun `starting node can itself be the target`() {
        val item = Node("cn.soulapp.android:id/item_content_root")

        val found = SoulNodeHierarchy.findIncludingSelf(
            start = item,
            parentOf = { it.parent },
            viewIdOf = { it.id },
            targetViewId = "cn.soulapp.android:id/item_content_root"
        )

        assertEquals(item, found)
    }

    @Test
    fun `missing target returns null`() {
        val node = Node("cn.soulapp.android:id/unread_msg_number")

        assertNull(
            SoulNodeHierarchy.findIncludingSelf(
                start = node,
                parentOf = { it.parent },
                viewIdOf = { it.id },
                targetViewId = "cn.soulapp.android:id/item_content_root"
            )
        )
    }
}
