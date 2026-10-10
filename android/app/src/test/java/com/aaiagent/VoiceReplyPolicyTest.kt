package com.aaiagent

import com.aaiagent.engine.VoiceReplyPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "这条回复要不要用语音发"的判断边界。
 *
 * 最要紧的一条：**默认必须是关的**。开关没显式打开之前，
 * 现有文字回复的行为一个字都不能变。
 */
class VoiceReplyPolicyTest {

    @Test
    fun `voice reply is off unless the switch is explicitly true`() {
        assertEquals(false, VoiceReplyPolicy.isEnabled(null))
        assertEquals(false, VoiceReplyPolicy.isEnabled(""))
        assertEquals(false, VoiceReplyPolicy.isEnabled("   "))
        assertEquals(false, VoiceReplyPolicy.isEnabled("false"))
        assertEquals(false, VoiceReplyPolicy.isEnabled("1"))
        assertEquals(false, VoiceReplyPolicy.isEnabled("yes"))
        assertEquals(false, VoiceReplyPolicy.isEnabled("开"))
        assertEquals(true, VoiceReplyPolicy.isEnabled("true"))
        assertEquals(true, VoiceReplyPolicy.isEnabled(" TRUE "))
    }

    @Test
    fun `an empty contact list means every contact once enabled`() {
        assertEquals(true, VoiceReplyPolicy.allowsContact(null, "任何人"))
        assertEquals(true, VoiceReplyPolicy.allowsContact("", "任何人"))
        assertEquals(true, VoiceReplyPolicy.allowsContact("   ", "任何人"))
    }

    @Test
    fun `a listed contact list only lets those contacts through`() {
        val list = "期待下一步的我们"
        assertEquals(true, VoiceReplyPolicy.allowsContact(list, "期待下一步的我们"))
        assertEquals(false, VoiceReplyPolicy.allowsContact(list, "仙逆"))
        assertEquals(false, VoiceReplyPolicy.allowsContact(list, ""))
    }

    @Test
    fun `contact list accepts both comma styles and stray spaces`() {
        val list = " 期待下一步的我们 ， 仙逆,光影杀手 "
        assertEquals(true, VoiceReplyPolicy.allowsContact(list, "期待下一步的我们"))
        assertEquals(true, VoiceReplyPolicy.allowsContact(list, "仙逆"))
        assertEquals(true, VoiceReplyPolicy.allowsContact(list, "光影杀手"))
        assertEquals(false, VoiceReplyPolicy.allowsContact(list, "别人"))
    }

    @Test
    fun `short replies fit one voice and long ones do not`() {
        assertEquals(true, VoiceReplyPolicy.textFitsOneVoice("在的呀，我今天不忙"))
        assertEquals(false, VoiceReplyPolicy.textFitsOneVoice(""))
        assertEquals(false, VoiceReplyPolicy.textFitsOneVoice("   "))
        val tooLong = "嗯".repeat(VoiceReplyPolicy.MAX_VOICE_TEXT_CHARS + 1)
        assertEquals(false, VoiceReplyPolicy.textFitsOneVoice(tooLong))
        val exactly = "嗯".repeat(VoiceReplyPolicy.MAX_VOICE_TEXT_CHARS)
        assertEquals(true, VoiceReplyPolicy.textFitsOneVoice(exactly))
    }

    @Test
    fun `the character limit stays inside one soul recording`() {
        // Soul 单条上限 60 秒；按每秒 4-5 个汉字算，200 字约 40-50 秒，必须留余量。
        assertEquals(true, VoiceReplyPolicy.MAX_VOICE_TEXT_CHARS in 80..260)
    }

    // ---- 媒体回复绝不许转成语音（2026-10-06 真机事故）----

    @Test
    fun `a reply that is supposed to carry media is never spoken`() {
        // 事故现场：对方问"看看你照片可以吗"，后端回 `action=send_media`，
        // 但那次媒体没选出来、掉进了文字分支 —— 语音岔路口把它接走，
        // 发了一条语音说"那就只发一张"。照片永远发不出去，说一套做一套。
        assertEquals(
            false,
            VoiceReplyPolicy.canSpeakAsVoice(
                enabled = true,
                contactAllowed = true,
                mediaExpected = true,
                text = "那就只发一张"
            )
        )
    }

    @Test
    fun `the teaser that goes out before a photo is never spoken`() {
        // 发照片的流程是「先说一句 → 再发图」，那句说明也走 sendReply。
        // 它要是变成语音，合成+录音要花十来秒，照片那一步就会判定过期、直接放弃 ——
        // 真机后果：她嘴上说"只发一张"，照片永远发不出去。
        assertEquals(
            false,
            VoiceReplyPolicy.canSpeakAsVoice(
                enabled = true,
                contactAllowed = true,
                mediaExpected = true,
                text = "那就只发一张"
            )
        )
    }

    @Test
    fun `a plain conversational reply can still be spoken`() {        assertEquals(
            true,
            VoiceReplyPolicy.canSpeakAsVoice(
                enabled = true,
                contactAllowed = true,
                mediaExpected = false,
                text = "在的呀，刚忙完手上的活"
            )
        )
    }

    @Test
    fun `every other gate still applies`() {
        val text = "在的呀"
        // 总开关关着
        assertEquals(false, VoiceReplyPolicy.canSpeakAsVoice(false, true, false, text))
        // 联系人不在名单里
        assertEquals(false, VoiceReplyPolicy.canSpeakAsVoice(true, false, false, text))
        // 文案太长
        assertEquals(
            false,
            VoiceReplyPolicy.canSpeakAsVoice(
                true, true, false, "嗯".repeat(VoiceReplyPolicy.MAX_VOICE_TEXT_CHARS + 1)
            )
        )
        // 空文案
        assertEquals(false, VoiceReplyPolicy.canSpeakAsVoice(true, true, false, "   "))
    }
}
