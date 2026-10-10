package com.aaiagent

import com.aaiagent.adapter.SoulAlbumSelectionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulAlbumSelectionPolicyTest {
    private data class Node(
        val name: String,
        val parent: Node? = null,
        val clickable: Boolean = false,
        val visible: Boolean = true
    )

    private fun choose(
        photo: Node,
        marker: Node?
    ): Node = SoulAlbumSelectionPolicy.chooseTapTarget(
        photo = photo,
        marker = marker,
        parentOf = { it.parent },
        isClickable = { it.clickable },
        isVisible = { it.visible }
    )

    @Test
    fun `sibling selection marker is preferred for Soul album photos`() {
        val parent = Node("photo_container", clickable = true)
        val photo = Node("iv_photo", parent)
        val marker = Node("fl_select_mark", parent, clickable = true)

        assertEquals(marker, choose(photo, marker))
    }

    @Test
    fun `clickable parent is used when marker is absent`() {
        val parent = Node("photo_container", clickable = true)
        val photo = Node("iv_photo", parent)

        assertEquals(parent, choose(photo, null))
    }

    @Test
    fun `photo remains the fallback when marker and clickable parent are absent`() {
        val hiddenMarker = Node("fl_select_mark", clickable = true, visible = false)
        val parent = Node("photo_container", clickable = false)
        val photo = Node("iv_photo", parent)

        assertEquals(photo, choose(photo, hiddenMarker))
    }

    @Test
    fun `selected content description prevents toggling the same Soul photo again`() {
        assertTrue(SoulAlbumSelectionPolicy.isSelectionMarkerSelected("图片第1个已选中", false))
        assertFalse(SoulAlbumSelectionPolicy.isSelectionMarkerSelected("图片第1个未选中", false))
    }

    @Test
    fun `album send fallback targets the visible bottom right control`() {
        val point = SoulAlbumSelectionPolicy.fallbackSendPoint(
            screenWidth = 1080,
            screenHeight = 2252
        )

        assertEquals(936, point.x)
        assertEquals(2155, point.y)
    }

    @Test
    fun `album send fallback follows Soul bottom bar when accessibility bounds are clipped`() {
        val point = SoulAlbumSelectionPolicy.fallbackSendPoint(
            screenWidth = 1080,
            screenHeight = 2252,
            bottomBarTop = 2237,
            bottomBarRight = 1080,
            bottomBarBottom = 2355
        )

        assertEquals(936, point.x)
        assertEquals(2296, point.y)
    }
}
