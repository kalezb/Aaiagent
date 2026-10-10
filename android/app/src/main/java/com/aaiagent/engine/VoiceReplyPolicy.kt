package com.aaiagent.engine

/**
 * "这条回复要不要用语音发"的判断。
 *
 * 默认**关闭**：语音回复是附加能力，没显式打开之前，行为跟以前一模一样。
 * 用纯函数写，方便单测把开/关、名单、长度这几条边界钉住。
 */
object VoiceReplyPolicy {

    /** 配置项：总开关。只有值是 "true" 才算开。 */
    const val ENABLED_KEY = "voice_reply_enabled"

    /** 配置项：生效的联系人名单，逗号分隔。留空表示"开了就对所有人生效"。 */
    const val CONTACTS_KEY = "voice_reply_contacts"

    /**
     * 一条语音最多装多少字的回复。
     *
     * 真机依据：Soul 单条录音上限 60 秒；Fish 配音大约每秒 4-5 个汉字，
     * 情绪浓、停顿多的时候会更慢。200 字大约 40-50 秒，留了余量。
     * 真正的兜底是合成之后按音频实际时长再判一次（见 MessageEngine.prepareVoiceAudio），
     * 这里只是提前挡掉明显太长的，省一次合成。
     */
    const val MAX_VOICE_TEXT_CHARS = 200

    /** 只有明确写了 "true" 才算开；没配、写错、写空一律当关。 */
    fun isEnabled(raw: String?): Boolean =
        raw?.trim()?.equals("true", ignoreCase = true) == true

    /**
     * 这个联系人能不能用语音。
     *
     * 名单为空 = 开了就都对；否则只认名单里的名字（中英文逗号都认）。
     */
    fun allowsContact(configured: String?, contactName: String): Boolean {
        val list = configured.orEmpty()
            .split(',', '，')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (list.isEmpty()) return true
        val name = contactName.trim()
        if (name.isEmpty()) return false
        return list.any { it == name }
    }

    /**
     * 文字长度是不是一条语音装得下。
     * 太长就干脆走文字 —— 拆成好几条语音砸过去比发文字还假。
     */
    fun textFitsOneVoice(text: String): Boolean {
        val trimmed = text.trim()
        return trimmed.isNotEmpty() && trimmed.length <= MAX_VOICE_TEXT_CHARS
    }

    /**
     * 这条回复到底能不能用语音发。
     *
     * **媒体回复（后端要求发照片/图片）一律不许转成语音。**
     *
     * 真机事故（2026-10-06 18:44）：对方问"看看你照片可以吗"，
     * 后端回的明明是 `action=send_media`（发照片），但那次媒体没选出来，
     * 于是掉进了文字分支 —— 而语音岔路口把它接走了，发了一条语音，
     * 她嘴上还说"那就只发一张"。**照片永远发不出去，说一套做一套。**
     *
     * 所以把"后端要的是媒体"当成硬门槛：命中就绝不用语音，老老实实按原来的路走。
     */
    fun canSpeakAsVoice(
        enabled: Boolean,
        contactAllowed: Boolean,
        mediaExpected: Boolean,
        text: String
    ): Boolean = enabled && contactAllowed && !mediaExpected && textFitsOneVoice(text)
}
