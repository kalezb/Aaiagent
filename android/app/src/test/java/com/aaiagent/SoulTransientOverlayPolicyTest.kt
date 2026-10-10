package com.aaiagent

import com.aaiagent.adapter.SoulTransientOverlayPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SoulTransientOverlayPolicyTest {
    @Test
    fun `recognizes full screen gift and light interaction overlays`() {
        assertTrue(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/fl_chat_card_content"
        ))
        assertTrue(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/pb_light_interaction"
        ))
        assertTrue(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/la_light_interaction"
        ))
        assertTrue(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/gift_fly_animation"
        ))
        assertTrue(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/lottie_heart"
        ))
        assertFalse(SoulTransientOverlayPolicy.shouldWaitForClear(
            "cn.soulapp.android:id/fl_chat_card_content"
        ))
        assertTrue(SoulTransientOverlayPolicy.shouldWaitForClear(
            "cn.soulapp.android:id/gift_fly_animation"
        ))
    }

    @Test
    fun `does not classify normal chat views as transient overlays`() {
        assertFalse(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/item_root"
        ))
        assertFalse(SoulTransientOverlayPolicy.isTransientViewId(
            "cn.soulapp.android:id/content_text"
        ))
        assertFalse(SoulTransientOverlayPolicy.isTransientViewId(null))
    }
}
