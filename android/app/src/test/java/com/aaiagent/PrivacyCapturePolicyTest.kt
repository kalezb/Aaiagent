package com.aaiagent

import com.aaiagent.engine.PrivacyPhotoPolicy
import com.aaiagent.engine.ScreenCapturePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyCapturePolicyTest {
    @Test
    fun `all black screenshot is rejected`() {
        assertTrue(ScreenCapturePolicy.isMostlyBlack(IntArray(400)))
    }

    @Test
    fun `visible content is accepted`() {
        val samples = IntArray(400) { 180 }
        assertFalse(ScreenCapturePolicy.isMostlyBlack(samples))
    }

    @Test
    fun `tiny highlights do not make a secure black frame usable`() {
        val samples = IntArray(400)
        repeat(4) { samples[it] = 255 }
        assertTrue(ScreenCapturePolicy.isMostlyBlack(samples))
    }

    @Test
    fun `privacy capture failure uses model context instead of generic fallback`() {
        assertTrue(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = true,
                captureAvailable = false
            )
        )
        assertFalse(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = true,
                captureAvailable = true
            )
        )
        assertFalse(
            PrivacyPhotoPolicy.shouldUseModelContext(
                privacyProtected = false,
                captureAvailable = false
            )
        )
    }

    // ---- 交给大模型的那段话，分寸和禁令都要钉死（用户 2026-10-06 定的）----

    /**
     * 真会穿帮的不是提示词本身，而是"看不清/截图/限制"这些字眼**被照抄进回复**。
     * 所以提示词里必须有一条点名禁令。
     */
    @Test
    fun `the privacy prompt explicitly forbids revealing why she cannot see it`() {
        val text = PrivacyPhotoPolicy.MODEL_CONTEXT
        assertTrue("必须有禁令", text.contains("绝对不要提"))
        for (forbidden in listOf("看不清", "看不到", "截图", "限制")) {
            assertTrue("禁令里要点名「$forbidden」", text.contains(forbidden))
        }
        assertTrue("还要禁止解释原因", text.contains("不要解释原因"))
    }

    /**
     * 用户定的分寸：像「长得还挺清爽的」这种随口一句，
     * **别用力、别堆形容词、别连着夸**。
     */
    @Test
    fun `the privacy prompt keeps the compliment light`() {
        val text = PrivacyPhotoPolicy.MODEL_CONTEXT
        assertTrue("要给个样子", text.contains("清爽"))
        assertTrue("要说明是随口一句", text.contains("随口"))
        assertTrue("要禁止堆形容词", text.contains("别堆形容词"))
        assertTrue("要禁止连着夸", text.contains("别连着夸"))
        assertTrue("要限长度", text.contains("一到两句"))
    }

    /**
     * 旧版提示词写死了"男性客户自拍"，对方是女的、或者发的不是自拍就错得离谱。
     * 现在只描述"对方愿意给你看长相"这件事，不预设性别。
     */
    @Test
    fun `the privacy prompt does not hardcode the contact gender`() {
        val text = PrivacyPhotoPolicy.MODEL_CONTEXT
        assertFalse("不该写死男性", text.contains("男性"))
        assertFalse("不该写死女性", text.contains("女性"))
        assertFalse("不该写死自拍", text.contains("自拍"))
    }
}
