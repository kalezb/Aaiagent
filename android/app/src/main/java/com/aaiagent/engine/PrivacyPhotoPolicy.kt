package com.aaiagent.engine

object PrivacyPhotoPolicy {
    const val MODEL_CONTEXT =
        "对方发来一张隐私保护自拍；由于平台安全限制，图片内容无法读取。" +
            "请只根据这是男性客户自拍这一信息，自然夸赞他的长相或气质，" +
            "一到两句，真诚、克制、不要浮夸。"

    fun shouldUseModelContext(privacyProtected: Boolean, captureAvailable: Boolean): Boolean {
        return privacyProtected && !captureAvailable
    }
}
