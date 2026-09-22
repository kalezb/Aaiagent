package com.aaiagent.engine

object SensitiveWords {
    private val words = listOf(
        "钱", "转账", "汇款", "银行卡", "账号", "密码",
        "验证码", "支付宝", "微信支付", "红包", "刷单",
        "贷款", "借款", "投资", "理财", "点击链接",
        "http://", "https://", "加微信", "加v", "加群"
    )
    fun isHit(text: String): Boolean = words.any { text.contains(it) }
}
